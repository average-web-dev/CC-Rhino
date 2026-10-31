// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/tty.ts — Node's `tty` module for CC TTYs.
//
// A TTY is native: a pair of pipes plus a line discipline (cooked mode with echo and line editing, or raw mode). A TTY
// is shown by a device (a console of the computer's screen, a monitor), whose terminal emulator renders its output, or
// it is virtual: whoever holds it reads what programs write and types for them.
//
//   const t = new TTY(20, 5);                  // a virtual TTY
//   t.stdout.write('hi');                       // what a program on it writes …
//   t.readOutput();                             // … is read by whoever holds it ('hi')
//   const mon = TTY.from(monitor.getTty());     // the TTY of a monitor
//
// ReadStream / WriteStream are the Node stream classes (process.stdin / process.stdout are instances): 'data', 'end'
// and 'keypress' events, pause/resume, setRawMode; write, cursorTo/moveCursor/clearLine, columns/rows.
//
// Listeners added with stream.on(...) are registered *natively* in the calling thread, on the `pipe_data` event the
// TTY pushes while the stream flows. So they belong to the thread that adds them: they may block, and they are
// discarded when that thread is stopped. Each listener holds a keep-alive handle while the stream flows, so a program
// reading a TTY stays alive (as in Node).

import events from 'events';
import loop from 'internal/loop';
import pty from 'internal/pty';
import { decodeKeys } from '/rom/lib/internal/keys';

const ESC = '\x1b';

/** Decode a chunk (string or bytes) to a string; bytes are taken as Latin-1, the terminal's character set. */
function chunkToString(chunk: unknown): string {
    if (typeof chunk === 'string') return chunk;
    if (chunk instanceof Uint8Array) {
        let out = '';
        for (let i = 0; i < chunk.length; i++) out += String.fromCharCode(chunk[i]);
        return out;
    }
    let err = new TypeError('The "chunk" argument must be of type string or an instance of Uint8Array');
    (err as any).code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

/** Call a write/cursor callback asynchronously, as Node does. */
function later(callback: unknown): void {
    if (typeof callback === 'function') events.queueMicrotask(() => (callback as (err: Error | null) => void)(null));
}

/** A CC colour (a power of two, 1 … 32768) as its blit index (0 = white … 15 = black). */
export function colourIndex(colour: number, argument = 'colour'): number {
    let index = typeof colour === 'number' && Number.isInteger(colour) && colour > 0 ? 31 - Math.clz32(colour) : -1;
    if (index < 0 || index > 15 || colour !== 2 ** index) {
        throw new RangeError(`${argument} must be a CC colour (a power of two from 1 to 32768), got ${String(colour)}`);
    }
    return index;
}

/**
 * The escape sequences a TTY understands, so programs (and the ROM) need not spell them out: cursor movement as
 * readline and Node's tty.WriteStream write it, plus showing the cursor, clearing, colours, blit and mouse reports.
 */
export const CSI = {
    /** Show the (blinking) cursor. */
    showCursor: `${ESC}[?25h`,
    /** Hide the cursor. */
    hideCursor: `${ESC}[?25l`,
    /** Clear the whole screen (the cursor stays). */
    clearScreen: `${ESC}[2J`,
    /** Move the cursor to the top left. */
    home: `${ESC}[H`,
    /** Back to the default colours. */
    reset: `${ESC}[0m`,
    /** Select CC colours (powers of two, as `colors`): text, and optionally background. */
    color(fg: number, bg?: number): string {
        let out = `${ESC}[38;6;${colourIndex(fg, 'fg')}`;
        if (bg !== undefined) out += `;48;6;${colourIndex(bg, 'bg')}`;
        return out + 'm';
    },
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): string {
        n = Math.trunc(n);
        return n > 0 ? `${ESC}[${n}S` : n < 0 ? `${ESC}[${-n}T` : '';
    },
    /** Write `text` with one text and one background colour (blit digits) per character, without wrapping. */
    blit(text: string, fg: string, bg: string): string {
        return `${ESC}Pcc-blit;${fg};${bg};${text}${ESC}\\`;
    },
    /** Ask for mouse reports in stdin (SGR encoding, presses, releases and drags), or stop them. */
    mouse(on: boolean): string {
        return on ? `${ESC}[?1002;1006h` : `${ESC}[?1002;1006l`;
    },
    cursorTo(x: number, y?: number): string {
        return typeof y !== 'number' ? `${ESC}[${x + 1}G` : `${ESC}[${y + 1};${x + 1}H`;
    },
    moveCursor(dx: number, dy: number): string {
        let data = '';
        if (dx < 0) data += `${ESC}[${-dx}D`; else if (dx > 0) data += `${ESC}[${dx}C`;
        if (dy < 0) data += `${ESC}[${-dy}A`; else if (dy > 0) data += `${ESC}[${dy}B`;
        return data;
    },
    clearLine(dir: number): string {
        return dir < 0 ? `${ESC}[1K` : dir > 0 ? `${ESC}[0K` : `${ESC}[2K`;
    },
    clearScreenDown: `${ESC}[0J`,
};

type Listener = (...args: any[]) => void;

/** Listeners of events other than the stream events (never emitted natively), so Node code adding e.g. 'error'
 * handlers keeps working. */
class LocalListeners {
    #table: { [event: string]: Listener[] | undefined } = {};

    add(event: string, fn: Listener): void {
        (this.#table[event] ?? (this.#table[event] = [])).push(fn);
    }

    remove(event: string, fn: Listener): void {
        let list = this.#table[event];
        if (list === undefined) return;
        let index = list.lastIndexOf(fn);
        if (index >= 0) list.splice(index, 1);
    }

    clear(event?: string): void {
        if (event === undefined) this.#table = {}; else delete this.#table[event];
    }

    count(event: string): number {
        return (this.#table[event] ?? []).length;
    }

    emit(self: unknown, event: string, args: unknown[]): boolean {
        let list = this.#table[event];
        if (list === undefined || list.length === 0) return false;
        let snapshot = list.slice();
        for (let i = 0; i < snapshot.length; i++) snapshot[i].apply(self, args);
        return true;
    }
}

/** The stream event fired when the TTY changes its size (native `tty_resize`). */
const RESIZE = 'resize';

interface ResizeListener {
    fn: Listener;
    native: (tty: number) => void;
}

/** Node's tty.WriteStream: what programs write to a TTY (`stdout` or `stderr`). */
export class WriteStream implements TtyWriteStream {
    readonly fd: number;
    readonly isTTY = true as const;
    readonly writable = true;
    #tty: TtyHandle;
    #pipe: PipeHandle;
    #local = new LocalListeners();
    #resize: ResizeListener[] = [];

    constructor(tty: TtyHandle, pipe: PipeHandle, fd: number) {
        this.#tty = tty;
        this.#pipe = pipe;
        this.fd = fd;
    }

    get columns(): number { return this.#tty.getSize().columns; }
    get rows(): number { return this.#tty.getSize().rows; }

    write(chunk: string | Uint8Array, encoding?: string | ((err: Error | null) => void), callback?: (err: Error | null) => void): boolean {
        if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
        this.#pipe.write(chunkToString(chunk));
        later(callback);
        return true;
    }

    cursorTo(x: number, y?: number | (() => void), callback?: () => void): boolean {
        if (typeof y === 'function') { callback = y; y = undefined; }
        return this.write(CSI.cursorTo(x, y), callback);
    }

    moveCursor(dx: number, dy: number, callback?: () => void): boolean {
        let data = CSI.moveCursor(dx, dy);
        if (data === '') { later(callback); return true; }
        return this.write(data, callback);
    }

    clearLine(dir: number, callback?: () => void): boolean { return this.write(CSI.clearLine(dir), callback); }
    clearScreenDown(callback?: () => void): boolean { return this.write(CSI.clearScreenDown, callback); }

    getWindowSize(): [number, number] {
        let size = this.#tty.getSize();
        return [size.columns, size.rows];
    }

    hasColors(count?: number | object): boolean {
        let n = typeof count === 'number' ? count : 16;
        return n <= (this.#tty.isColor() ? 16 : 2);
    }

    getColorDepth(): number { return this.#tty.isColor() ? 4 : 1; }

    on(event: string, listener: Listener): this {
        if (event === RESIZE) this.#addResize(listener, false); else this.#local.add(event, listener);
        return this;
    }

    /** 'resize' listeners are native `tty_resize` listeners of the calling thread, filtered to this TTY. */
    #addResize(listener: Listener, once: boolean): void {
        let id = this.#tty.getId();
        let entry: ResizeListener = {
            fn: listener,
            native: (tty: number) => {
                if (tty !== id) return;
                if (once) this.#removeResize(entry);
                listener.call(this);
            },
        };
        this.#resize.push(entry);
        events.on('tty_resize', entry.native);
    }

    #removeResize(entry: ResizeListener): void {
        let index = this.#resize.indexOf(entry);
        if (index >= 0) this.#resize.splice(index, 1);
        events.off('tty_resize', entry.native);
    }

    addListener(event: string, listener: Listener): this { return this.on(event, listener); }

    once(event: string, listener: Listener): this {
        if (event === RESIZE) { this.#addResize(listener, true); return this; }
        let local = this.#local;
        let wrapper = function (this: unknown, ...args: unknown[]) {
            local.remove(event, wrapper);
            listener.apply(this, args);
        };
        local.add(event, wrapper);
        return this;
    }

    off(event: string, listener: Listener): this {
        if (event !== RESIZE) { this.#local.remove(event, listener); return this; }
        for (let i = this.#resize.length - 1; i >= 0; i--) {
            if (this.#resize[i].fn === listener) { this.#removeResize(this.#resize[i]); break; }
        }
        return this;
    }

    removeListener(event: string, listener: Listener): this { return this.off(event, listener); }

    removeAllListeners(event?: string): this {
        this.#local.clear(event);
        if (event === undefined || event === RESIZE) {
            for (let entry of this.#resize.slice()) this.#removeResize(entry);
        }
        return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
        if (event !== RESIZE) return this.#local.emit(this, event, args);
        let snapshot = this.#resize.slice();
        for (let entry of snapshot) entry.fn.apply(this, args);
        return snapshot.length > 0;
    }

    listenerCount(event: string): number {
        return event === RESIZE ? this.#resize.length : this.#local.count(event);
    }
}

const STREAM_EVENTS: Record<string, true> = { data: true, keypress: true, end: true };

/** A listener added with stream.on(...) for a stream event. */
interface Subscription {
    event: string;
    fn: Listener;
    once: boolean;
    active: boolean;
    /** The owner tag when it was added (see ReadStreamOptions.owner). */
    owner: number;
    /** A custom event with a no-op listener, registered in the same thread: its listener count says whether the
     * thread is still alive (listeners of a stopped thread are discarded). */
    probe: string;
    noop: Listener;
    wrapper: (pipe: number, data: string | null | undefined) => void;
    /** A keep-alive handle owned by the subscribing thread: ref'd while the stream flows. */
    handle: number;
}

let nextSubscription = 1;

/** Options for a ReadStream (used by process.stdin). */
export interface ReadStreamOptions {
    /** Who adds listeners now (the running job): removeAllListeners() only removes the current owner's. */
    owner?: () => number;
    /** Called when the stream starts (true) or stops (false) flowing. */
    onFlowing?: (flowing: boolean) => void;
    /** The pipe to read (default: the TTY's stdin; a ChildProcess reads its child's stdout this way). */
    pipe?: PipeHandle;
}

/** Node's tty.ReadStream: what programs read from a TTY (`stdin`). */
export class ReadStream implements TtyReadStream {
    readonly fd = 0;
    readonly isTTY = true as const;
    readonly readable = true;
    #tty: TtyHandle;
    #pipe: PipeHandle;
    #pipeId: number;
    #options: ReadStreamOptions;
    #flowing: boolean | null = null;
    #refd = true;
    #subscriptions: Subscription[] = [];
    #local = new LocalListeners();

    constructor(tty: TtyHandle, options: ReadStreamOptions = {}) {
        this.#tty = tty;
        this.#pipe = options.pipe ?? tty.getStdin();
        this.#pipeId = this.#pipe.getId();
        this.#options = options;
    }

    get isRaw(): boolean { return this.#tty.isRaw(); }
    /** Node's readableFlowing: null until someone reads, true while flowing, false once paused. */
    get readableFlowing(): boolean | null { return this.#flowing; }

    /** Set readableFlowing directly (used by job control to give a program a fresh stdin). */
    setFlowing(value: boolean | null): void {
        let was = this.#flowing === true;
        this.#flowing = value;
        this.#pipe.setFlowing(value === true);
        if (was !== (value === true) && this.#options.onFlowing) this.#options.onFlowing(value === true);
        this.#syncHandles();
    }

    setRawMode(mode: boolean): this {
        this.#tty.setRaw(!!mode);
        return this;
    }

    pause(): this {
        if (this.#flowing !== false) {
            this.setFlowing(false);
            this.#local.emit(this, 'pause', []);
        }
        return this;
    }

    resume(): this {
        if (this.#flowing !== true) {
            this.setFlowing(true);
            this.#local.emit(this, 'resume', []);
        }
        return this;
    }

    isPaused(): boolean { return this.#flowing === false; }
    setEncoding(_encoding?: string): this { return this; }
    ref(): this { this.#refd = true; this.#syncHandles(); return this; }
    unref(): this { this.#refd = false; this.#syncHandles(); return this; }

    /**
     * CC extension: wait until input is available and return it (in cooked mode a line, in raw mode what was typed),
     * or `undefined` at end of input. For programs that read input step by step rather than with listeners.
     */
    readSync(): string | undefined {
        return this.#pipe.read();
    }

    /** Drop what was typed but not read yet. */
    discard(): void {
        while (true) {
            let data = this.#pipe.tryRead();
            if (data === undefined || data === '') return;
        }
    }

    #owner(): number {
        return this.#options.owner ? this.#options.owner() : 0;
    }

    /** A program reading a TTY stays alive while the stream flows (is not paused) and is ref'd. */
    #syncHandles(): void {
        let keep = this.#flowing !== false && this.#refd;
        for (let sub of this.#subscriptions) loop.handleRef(sub.handle, keep);
    }

    #unsubscribe(sub: Subscription): void {
        if (!sub.active) return;
        sub.active = false;
        events.off('pipe_data', sub.wrapper);
        events.off(sub.probe, sub.noop);
        loop.handleClose(sub.handle);
        let index = this.#subscriptions.indexOf(sub);
        if (index >= 0) this.#subscriptions.splice(index, 1);
    }

    /** Forget subscriptions whose thread has been stopped. */
    #prune(): void {
        let alive: Subscription[] = [];
        for (let sub of this.#subscriptions) {
            if (sub.active && events.listenerCount(sub.probe) > 0) { alive.push(sub); continue; }
            sub.active = false;
            loop.handleClose(sub.handle);
        }
        this.#subscriptions = alive;
    }

    /** Deliver what the TTY pushed to one subscription, as its stream event (`null`: end of input). */
    #deliver(sub: Subscription, data: string | null | undefined): void {
        if (sub.event === 'end') {
            if (data != null) return;
            if (sub.once) this.#unsubscribe(sub);
            sub.fn.call(this);
        } else if (sub.event === 'data') {
            if (data == null) return;
            if (sub.once) this.#unsubscribe(sub);
            sub.fn.call(this, data);
        } else if (data != null) {
            decodeKeys(data, (s, key) => {
                if (!sub.active) return;
                if (sub.once) this.#unsubscribe(sub);
                sub.fn.call(this, s, key);
            });
        }
    }

    #subscribe(event: string, fn: Listener, once: boolean): void {
        if (typeof fn !== 'function') throw new TypeError('The "listener" argument must be of type function');
        this.#prune();
        let sub: Subscription = {
            event, fn, once, active: true, owner: this.#owner(),
            probe: 'tty:stdin:' + nextSubscription++,
            noop: () => { /* liveness probe */ },
            wrapper: (pipe: number, data: string | null | undefined) => {
                if (pipe !== this.#pipeId || !sub.active) return;
                this.#deliver(sub, data);
            },
            handle: loop.handle(),
        };
        events.on('pipe_data', sub.wrapper);
        events.on(sub.probe, sub.noop);
        this.#subscriptions.push(sub);
        // Like Node: adding a 'data' listener starts the flow, unless the stream was paused explicitly.
        if (event === 'data' && this.#flowing === null) this.resume();
        this.#syncHandles();
    }

    /** Remove the stream listeners added by `owner` (job control: what a program left behind). */
    removeListenersOf(owner: number): void {
        for (let sub of this.#subscriptions.slice()) if (sub.owner === owner) this.#unsubscribe(sub);
    }

    on(event: string, listener: Listener): this {
        if (STREAM_EVENTS[event]) this.#subscribe(event, listener, false); else this.#local.add(event, listener);
        return this;
    }

    addListener(event: string, listener: Listener): this { return this.on(event, listener); }

    once(event: string, listener: Listener): this {
        if (STREAM_EVENTS[event]) { this.#subscribe(event, listener, true); return this; }
        let local = this.#local;
        let wrapper = function (this: unknown, ...args: unknown[]) {
            local.remove(event, wrapper);
            listener.apply(this, args);
        };
        local.add(event, wrapper);
        return this;
    }

    off(event: string, listener: Listener): this {
        if (!STREAM_EVENTS[event]) { this.#local.remove(event, listener); return this; }
        for (let i = this.#subscriptions.length - 1; i >= 0; i--) {
            let sub = this.#subscriptions[i];
            if (sub.event === event && sub.fn === listener) { this.#unsubscribe(sub); break; }
        }
        return this;
    }

    removeListener(event: string, listener: Listener): this { return this.off(event, listener); }

    /** Removes the listeners added by the current owner (a program cannot remove the shell's). */
    removeAllListeners(event?: string): this {
        let owner = this.#owner();
        for (let sub of this.#subscriptions.slice()) {
            if (sub.owner === owner && (event === undefined || sub.event === event)) this.#unsubscribe(sub);
        }
        this.#local.clear(event);
        return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
        if (!STREAM_EVENTS[event]) return this.#local.emit(this, event, args);
        // Deliver directly to the listeners (from the calling thread, so they cannot block here).
        this.#prune();
        let any = false;
        for (let sub of this.#subscriptions.slice()) {
            if (sub.event !== event || !sub.active) continue;
            any = true;
            if (sub.once) this.#unsubscribe(sub);
            sub.fn.apply(this, args);
        }
        return any;
    }

    listenerCount(event: string): number {
        if (!STREAM_EVENTS[event]) return this.#local.count(event);
        this.#prune();
        let count = 0;
        for (let sub of this.#subscriptions) if (sub.event === event) count++;
        return count;
    }
}

/** The native TTY TTY.from() hands to the constructor. */
let wrapping: TtyHandle | undefined;

/**
 * A TTY: `stdin` (what programs read; input() types into it), `stdout` / `stderr` (what programs write; for a virtual
 * TTY, readOutput() / readErrorOutput() read it).
 */
export class TTY {
    readonly stdin: ReadStream;
    readonly stdout: WriteStream;
    readonly stderr: WriteStream;
    /** The native TTY. */
    readonly handle: TtyHandle;

    /**
     * A virtual TTY (not shown anywhere): `new TTY(columns?, rows?)` (default 51 × 19). To wrap the TTY of a device
     * (a console, a monitor), use TTY.from(handle).
     */
    constructor(columns?: number, rows?: number, options?: ReadStreamOptions) {
        this.handle = wrapping ?? pty.create(columns, rows);
        wrapping = undefined;
        // A device shows the cursor while its stdin is read (a virtual TTY's output gets no cursor sequences).
        let onFlowing = options?.onFlowing;
        if (onFlowing === undefined && this.handle.getCursorColumn() !== undefined) {
            let shown = false;
            onFlowing = (flowing: boolean) => {
                if (flowing === shown) return;
                shown = flowing;
                this.stdout.write(flowing ? CSI.showCursor : CSI.hideCursor);
            };
        }
        this.stdin = new ReadStream(this.handle, { ...options, onFlowing });
        this.stdout = new WriteStream(this.handle, this.handle.getStdout(), 1);
        this.stderr = new WriteStream(this.handle, this.handle.getStderr(), 2);
    }

    /** Wrap a native TTY (`monitor.getTty()`, `require('screen').getConsole(n)`). */
    static from(handle: TtyHandle, options?: ReadStreamOptions): TTY {
        wrapping = handle;
        return new TTY(undefined, undefined, options);
    }

    get columns(): number { return this.handle.getSize().columns; }
    get rows(): number { return this.handle.getSize().rows; }
    get isRaw(): boolean { return this.handle.isRaw(); }

    setRawMode(mode: boolean): this {
        this.handle.setRaw(!!mode);
        return this;
    }

    isColor(): boolean { return this.handle.isColor(); }

    /** Resize a virtual TTY. */
    setSize(columns: number, rows: number): void { this.handle.setSize(columns, rows); }

    /** What programs write to `stdout` (a virtual TTY): blocks until there is some; `undefined` once it ended. */
    readOutput(): string | undefined { return this.handle.getStdout().read(); }

    /** What programs write to `stderr` (a virtual TTY). */
    readErrorOutput(): string | undefined { return this.handle.getStderr().read(); }

    /** Type into the TTY: the text passes its line discipline, as if typed. */
    input(text: string): void { this.handle.getStdin().write(text); }

    /** The cursor column of the device showing this TTY (0 at the start of a line), or undefined for a virtual one. */
    cursorColumn(): number | undefined { return this.handle.getCursorColumn(); }
}

/** Whether `fd` is a TTY: process.stdin/stdout/stderr (0, 1, 2) always are. */
export function isatty(fd: number): boolean {
    return fd === 0 || fd === 1 || fd === 2;
}
