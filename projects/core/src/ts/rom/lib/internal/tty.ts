// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/tty.ts — the terminal "driver" behind process.stdin/stdout/stderr, plus job control for the shell.
//
// Output: stdout/stderr write to the computer's terminal with VT-style semantics: text wraps at the right edge
// (pending wrap: a full row only wraps when the next character arrives), scrolls at the bottom, honours \n \r \t \b,
// and interprets a subset of ANSI/VT100 escape sequences — SGR colours (mapped onto the 16 CC colours) and the
// cursor/erase sequences readline uses (CUU/CUD/CUF/CUB, CHA, CUP, ED, EL, …). stderr writes in red.
//
// Input: the computer's char/key/key_up/paste events are turned into a Node-style TTY stream. A single "driver" (event
// listeners registered by the bios, i.e. the root thread, before anything else) translates each event once: raw mode
// produces VT sequences, cooked mode runs a line discipline (echo, backspace, Enter, Ctrl+D). Listeners added with
// process.stdin.on(...) are registered *natively* in the calling thread — on the same input events, after the driver —
// and pick up what the driver produced for the event. So a program's stdin listeners belong to the program: they may
// block (they are entered from the event loop) and are discarded when it is stopped (Ctrl+T).
//
// Job control: the shell runs each program as a job. beginJob() gives the program a fresh stdin (not flowing, cooked);
// waitForJob() keeps the program running while it reads stdin (like Node keeps a process alive while stdin is
// flowing); endJob() closes the job's stdin listeners and restores the shell's terminal state.

const term = require('term');
const events = require('events');
const system = require('system');
const asyncMod = require('async');

// ── Colours ──────────────────────────────────────────────────────────────────────

const WHITE = 1, ORANGE = 2, MAGENTA = 4, LIGHT_BLUE = 8, YELLOW = 16, LIME = 32, PINK = 64, GRAY = 128,
    LIGHT_GRAY = 256, CYAN = 512, PURPLE = 1024, BLUE = 2048, GREEN = 8192, RED = 16384, BLACK = 32768;

/** ANSI colour index (0–7 normal, 8–15 bright) → CC colour. */
const ANSI_COLOURS: number[] = [
    BLACK, RED, GREEN, ORANGE, BLUE, PURPLE, CYAN, LIGHT_GRAY,
    GRAY, PINK, LIME, YELLOW, LIGHT_BLUE, MAGENTA, CYAN, WHITE,
];

const DEFAULT_FG = WHITE;
const DEFAULT_BG = BLACK;
const ERROR_FG = RED;

const ESC = '\x1b';

// ── Output ───────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/** Move to the start of the next row, scrolling when the cursor is on the last one. */
function newLine(): void {
    let y = term.getCursorPos().y;
    let height = term.getSize().height;
    if (y + 1 >= height) {
        term.scroll(1);
        term.setCursorPos({ x: 0, y: height - 1 });
    } else {
        term.setCursorPos({ x: 0, y: y + 1 });
    }
}

/** Write printable text at the cursor, wrapping at the right edge (term.write itself clips). */
function putText(text: string): void {
    let width = term.getSize().width;
    while (text.length > 0) {
        let room = width - term.getCursorPos().x;
        if (room <= 0) { newLine(); continue; }          // pending wrap: the row is full
        if (text.length <= room) { term.write(text); return; }
        term.write(text.slice(0, room));
        text = text.slice(room);
        newLine();
    }
}

/** Overwrite `count` cells from the cursor with spaces (current background), keeping the cursor where it was. */
function blank(x: number, y: number, count: number): void {
    if (count <= 0) return;
    let pos = term.getCursorPos();
    term.setCursorPos({ x, y });
    term.write(' '.repeat(count));
    term.setCursorPos(pos);
}

/** Per-stream output state: the default text colour and any escape sequence split across write() calls. */
interface OutputState {
    defaultFg: number;
    pending: string;
}

let savedCursor: { x: number; y: number } | null = null;

function setFg(colour: number): void { if (term.isColor()) term.setTextColor(colour); }
function setBg(colour: number): void { if (term.isColor()) term.setBackgroundColor(colour); }

/** Apply an SGR (`ESC [ … m`) parameter list. */
function applySgr(params: number[], state: OutputState): void {
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
        let p = params[i];
        if (p === 0) { setFg(state.defaultFg); setBg(DEFAULT_BG); }
        else if (p >= 30 && p <= 37) setFg(ANSI_COLOURS[p - 30]);
        else if (p >= 90 && p <= 97) setFg(ANSI_COLOURS[p - 90 + 8]);
        else if (p === 39) setFg(state.defaultFg);
        else if (p >= 40 && p <= 47) setBg(ANSI_COLOURS[p - 40]);
        else if (p >= 100 && p <= 107) setBg(ANSI_COLOURS[p - 100 + 8]);
        else if (p === 49) setBg(DEFAULT_BG);
        else if (p === 38 || p === 48) {
            // Extended colours: 5;n (256-colour palette — only its first 16 entries map onto CC colours) or 2;r;g;b.
            let mode = params[i + 1];
            if (mode === 5) {
                let n = params[i + 2];
                if (n !== undefined && n < 16) {
                    if (p === 38) setFg(ANSI_COLOURS[n]); else setBg(ANSI_COLOURS[n]);
                }
                i += 2;
            } else if (mode === 2) {
                i += 4;
            }
        }
        // Everything else (bold, italic, underline, inverse, …) has no equivalent on a CC terminal and is ignored.
    }
}

/** Execute a CSI sequence with the given parameters and final character. */
function applyCsi(paramText: string, final: string, state: OutputState): void {
    let priv = paramText.charAt(0) === '?';
    let parts = (priv ? paramText.slice(1) : paramText).split(';');
    let params: number[] = [];
    for (let part of parts) if (part !== '') params.push(parseInt(part, 10));
    let n = params[0] === undefined || params[0] === 0 ? 1 : params[0];

    if (priv) {
        if (params[0] === 25 && final === 'h') term.setCursorBlink(true);
        else if (params[0] === 25 && final === 'l') term.setCursorBlink(false);
        return;
    }

    let size = term.getSize();
    let pos = term.getCursorPos();
    // A cursor in the pending-wrap position (x === width) counts as being on the last column.
    let x = Math.min(pos.x, size.width - 1);
    switch (final) {
        case 'm': applySgr(params, state); break;
        case 'A': term.setCursorPos({ x, y: clamp(pos.y - n, 0, size.height - 1) }); break;
        case 'B': term.setCursorPos({ x, y: clamp(pos.y + n, 0, size.height - 1) }); break;
        case 'C': term.setCursorPos({ x: clamp(x + n, 0, size.width - 1), y: pos.y }); break;
        case 'D': term.setCursorPos({ x: clamp(x - n, 0, size.width - 1), y: pos.y }); break;
        case 'E': term.setCursorPos({ x: 0, y: clamp(pos.y + n, 0, size.height - 1) }); break;
        case 'F': term.setCursorPos({ x: 0, y: clamp(pos.y - n, 0, size.height - 1) }); break;
        case 'G': term.setCursorPos({ x: clamp(n - 1, 0, size.width - 1), y: pos.y }); break;
        case 'H': case 'f': {
            let row = params[0] === undefined || params[0] === 0 ? 1 : params[0];
            let col = params[1] === undefined || params[1] === 0 ? 1 : params[1];
            term.setCursorPos({ x: clamp(col - 1, 0, size.width - 1), y: clamp(row - 1, 0, size.height - 1) });
            break;
        }
        case 'J': {
            let mode = params[0] ?? 0;
            if (mode === 2 || mode === 3) { term.clear(); break; }
            if (mode === 0) {
                blank(x, pos.y, size.width - x);
                for (let row = pos.y + 1; row < size.height; row++) { term.setCursorPos({ x: 0, y: row }); term.clearLine(); }
            } else {
                for (let row = 0; row < pos.y; row++) { term.setCursorPos({ x: 0, y: row }); term.clearLine(); }
                blank(0, pos.y, x + 1);
            }
            term.setCursorPos(pos);
            break;
        }
        case 'K': {
            let mode = params[0] ?? 0;
            if (mode === 0) blank(x, pos.y, size.width - x);
            else if (mode === 1) blank(0, pos.y, x + 1);
            else { term.clearLine(); term.setCursorPos(pos); }
            break;
        }
        case 'S': term.scroll(n); break;
        case 'T': term.scroll(-n); break;
        case 's': savedCursor = { x: pos.x, y: pos.y }; break;
        case 'u': if (savedCursor !== null) term.setCursorPos(savedCursor); break;
        // Any other sequence is consumed without effect.
    }
}

/**
 * Write `text` to the terminal, interpreting control characters and escape sequences. Incomplete escape sequences at
 * the end are kept in `state.pending` and completed by the next write.
 */
function writeTerminal(text: string, state: OutputState): void {
    text = state.pending + text;
    state.pending = '';
    let run = '';
    let i = 0;
    while (i < text.length) {
        let ch = text.charAt(i);
        let code = text.charCodeAt(i);
        if (code >= 0x20 && code !== 0x7f) { run += ch; i++; continue; }

        if (run !== '') { putText(run); run = ''; }
        if (ch === '\n') { newLine(); i++; continue; }
        if (ch === '\r') { term.setCursorPos({ x: 0, y: term.getCursorPos().y }); i++; continue; }
        if (ch === '\t') {
            let x = term.getCursorPos().x;
            let width = term.getSize().width;
            if (x >= width) { newLine(); x = 0; }
            putText(' '.repeat(Math.min(8 - (x % 8), width - x)));
            i++;
            continue;
        }
        if (ch === '\b') {
            let pos = term.getCursorPos();
            if (pos.x > 0) term.setCursorPos({ x: pos.x - 1, y: pos.y });
            i++;
            continue;
        }
        if (ch === ESC) {
            if (i + 1 >= text.length) { state.pending = text.slice(i); return; }
            let next = text.charAt(i + 1);
            if (next === '[') {
                let j = i + 2;
                while (j < text.length && /[0-9;?]/.test(text.charAt(j))) j++;
                if (j >= text.length) { state.pending = text.slice(i); return; }
                applyCsi(text.slice(i + 2, j), text.charAt(j), state);
                i = j + 1;
            } else {
                i += 2; // two-character escape (ESC 7, ESC c, …): ignored
            }
            continue;
        }
        // Other C0 controls (bell, …) have no visible effect.
        i++;
    }
    if (run !== '') putText(run);
}

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

/** The CSI sequences readline (and Node's tty.WriteStream cursor methods) write. */
const CSI = {
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

/** Listeners added through a stream's `on`; `term_resize` is the only output event the computer can deliver. */
type Listener = (...args: any[]) => void;

/** Extra (never emitted) listeners, so Node code registering e.g. 'error' or 'drain' handlers keeps working. */
interface LocalListeners { [event: string]: Listener[] | undefined; }

function addLocal(table: LocalListeners, event: string, fn: Listener): void {
    (table[event] ?? (table[event] = [])).push(fn);
}

function removeLocal(table: LocalListeners, event: string, fn: Listener): void {
    let list = table[event];
    if (list === undefined) return;
    let index = list.lastIndexOf(fn);
    if (index >= 0) list.splice(index, 1);
}

function emitLocal(self: unknown, table: LocalListeners, event: string, args: unknown[]): boolean {
    let list = table[event];
    if (list === undefined || list.length === 0) return false;
    let snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) snapshot[i].apply(self, args);
    return true;
}

function makeWriteStream(fd: number, defaultFg: number): TtyWriteStream {
    let state: OutputState = { defaultFg, pending: '' };
    let local: LocalListeners = {};

    let stream: TtyWriteStream = {
        fd,
        isTTY: true,
        writable: true,
        get columns() { return term.getSize().width; },
        get rows() { return term.getSize().height; },

        write(chunk: string | Uint8Array, encoding?: string | ((err: Error | null) => void), callback?: (err: Error | null) => void): boolean {
            if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
            let text = chunkToString(chunk);
            if (defaultFg !== DEFAULT_FG && term.isColor()) {
                // stderr: write in the error colour, then restore the colour the terminal had.
                let previous = term.getTextColor();
                term.setTextColor(defaultFg);
                try { writeTerminal(text, state); } finally { term.setTextColor(previous); }
            } else {
                writeTerminal(text, state);
            }
            later(callback);
            return true;
        },

        cursorTo(x: number, y?: number | (() => void), callback?: () => void): boolean {
            if (typeof y === 'function') { callback = y; y = undefined; }
            return stream.write(CSI.cursorTo(x, y), callback);
        },
        moveCursor(dx: number, dy: number, callback?: () => void): boolean {
            let data = CSI.moveCursor(dx, dy);
            if (data === '') { later(callback); return true; }
            return stream.write(data, callback);
        },
        clearLine(dir: number, callback?: () => void): boolean { return stream.write(CSI.clearLine(dir), callback); },
        clearScreenDown(callback?: () => void): boolean { return stream.write(CSI.clearScreenDown, callback); },
        getWindowSize(): [number, number] {
            let size = term.getSize();
            return [size.width, size.height];
        },
        hasColors(count?: number | object): boolean {
            let n = typeof count === 'number' ? count : 16;
            return n <= (term.isColor() ? 16 : 2);
        },
        getColorDepth(): number { return term.isColor() ? 4 : 1; },

        on(event: string, listener: Listener) {
            if (event === 'resize') events.on('term_resize', listener); else addLocal(local, event, listener);
            return stream;
        },
        addListener(event: string, listener: Listener) { return stream.on(event, listener); },
        once(event: string, listener: Listener) {
            if (event === 'resize') { events.once('term_resize', listener); return stream; }
            let wrapper = function (this: unknown) {
                let args: unknown[] = Array.prototype.slice.call(arguments);
                removeLocal(local, event, wrapper);
                listener.apply(this, args);
            };
            addLocal(local, event, wrapper);
            return stream;
        },
        off(event: string, listener: Listener) {
            if (event === 'resize') events.off('term_resize', listener); else removeLocal(local, event, listener);
            return stream;
        },
        removeListener(event: string, listener: Listener) { return stream.off(event, listener); },
        removeAllListeners(event?: string) {
            if (event === undefined) { for (let key of Object.keys(local)) delete local[key]; } else delete local[event];
            return stream;
        },
        emit(event: string) {
            // `arguments` rather than a rest parameter: Rhino mixes up `event, ...args` when emit is applied.
            let args: unknown[] = Array.prototype.slice.call(arguments, 1);
            if (event === 'resize') return events.emit('term_resize');
            return emitLocal(stream, local, event, args);
        },
        listenerCount(event: string): number {
            if (event === 'resize') return events.listenerCount('term_resize');
            return (local[event] ?? []).length;
        },
    };
    return stream;
}

const stdout = makeWriteStream(1, DEFAULT_FG);
const stderr = makeWriteStream(2, ERROR_FG);

// ── Input ────────────────────────────────────────────────────────────────────────

/** GLFW key codes the computer reports. */
const KEY = {
    ESCAPE: 256, ENTER: 257, TAB: 258, BACKSPACE: 259, INSERT: 260, DELETE: 261, RIGHT: 262, LEFT: 263, DOWN: 264,
    UP: 265, PAGE_UP: 266, PAGE_DOWN: 267, HOME: 268, END: 269, F1: 290, F12: 301, KP_ENTER: 335,
    LEFT_SHIFT: 340, LEFT_CONTROL: 341, LEFT_ALT: 342, RIGHT_SHIFT: 344, RIGHT_CONTROL: 345, RIGHT_ALT: 346,
    A: 65, Z: 90,
};

/** Special keys: Node key name and the VT sequence a terminal would send (`~` sequences take a modifier code). */
const SPECIAL: Record<number, [string, string]> = {};
SPECIAL[KEY.ESCAPE] = ['escape', ESC];
SPECIAL[KEY.ENTER] = ['return', '\r'];
SPECIAL[KEY.KP_ENTER] = ['return', '\r'];
SPECIAL[KEY.TAB] = ['tab', '\t'];
SPECIAL[KEY.BACKSPACE] = ['backspace', '\x7f'];
SPECIAL[KEY.INSERT] = ['insert', '2~'];
SPECIAL[KEY.DELETE] = ['delete', '3~'];
SPECIAL[KEY.PAGE_UP] = ['pageup', '5~'];
SPECIAL[KEY.PAGE_DOWN] = ['pagedown', '6~'];
SPECIAL[KEY.UP] = ['up', 'A'];
SPECIAL[KEY.DOWN] = ['down', 'B'];
SPECIAL[KEY.RIGHT] = ['right', 'C'];
SPECIAL[KEY.LEFT] = ['left', 'D'];
SPECIAL[KEY.HOME] = ['home', 'H'];
SPECIAL[KEY.END] = ['end', 'F'];

const FUNCTION_KEYS = ['OP', 'OQ', 'OR', 'OS', '15~', '17~', '18~', '19~', '20~', '21~', '23~', '24~'];

const modifiers = { ctrl: false, shift: false, meta: false };

function isModifier(key: number): boolean {
    return key === KEY.LEFT_SHIFT || key === KEY.RIGHT_SHIFT || key === KEY.LEFT_CONTROL ||
        key === KEY.RIGHT_CONTROL || key === KEY.LEFT_ALT || key === KEY.RIGHT_ALT;
}

function trackModifier(key: number, down: boolean): void {
    if (key === KEY.LEFT_SHIFT || key === KEY.RIGHT_SHIFT) modifiers.shift = down;
    else if (key === KEY.LEFT_CONTROL || key === KEY.RIGHT_CONTROL) modifiers.ctrl = down;
    else if (key === KEY.LEFT_ALT || key === KEY.RIGHT_ALT) modifiers.meta = down;
}

/** xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
function modifierCode(): number {
    return 1 + (modifiers.shift ? 1 : 0) + (modifiers.meta ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
}

function makeKey(name: string | undefined, sequence: string): Key {
    return { sequence, name, ctrl: modifiers.ctrl, meta: modifiers.meta, shift: modifiers.shift };
}

/** The Node key object for a typed character. */
function charKey(ch: string): Key {
    let key = makeKey(undefined, modifiers.meta ? ESC + ch : ch);
    if (/^[0-9A-Za-z]$/.test(ch)) {
        key.name = ch.toLowerCase();
        key.shift = /^[A-Z]$/.test(ch);
    } else if (ch === ' ') {
        key.name = 'space';
    }
    return key;
}

/** One thing the driver produced for an input event: a stream event and its arguments. */
interface Output { event: string; args: unknown[]; }

/** What the driver produced for the event currently being dispatched (read by the subscription wrappers). */
let produced: Output[] = [];

interface StdinState {
    raw: boolean;
    /** Node's readableFlowing: null until someone reads, true while flowing, false once paused. */
    flowing: boolean | null;
    /** Cooked mode: the line typed so far. */
    line: string;
}

const stdinState: StdinState = { raw: false, flowing: null, line: '' };

function emitData(data: string): void { produced.push({ event: 'data', args: [data] }); }
function emitKeypress(s: string | undefined, key: Key): void { produced.push({ event: 'keypress', args: [s, key] }); }

/** Cooked mode: erase the last character of the line on screen. */
function eraseCharacter(): void {
    let pos = term.getCursorPos();
    let width = term.getSize().width;
    let x = Math.min(pos.x, width) - 1, y = pos.y;
    if (x < 0) { if (y === 0) return; y--; x = width - 1; }
    term.setCursorPos({ x, y });
    term.write(' ');
    term.setCursorPos({ x, y });
}

/** Cooked mode (line discipline): echo, edit and deliver complete lines. */
function cookedText(text: string): void {
    for (let i = 0; i < text.length; i++) {
        let ch = text.charAt(i);
        if (ch === '\n' || ch === '\r') { cookedEnter(); continue; }
        stdinState.line += ch;
        stdout.write(ch);
    }
}

function cookedEnter(): void {
    let line = stdinState.line + '\n';
    stdinState.line = '';
    stdout.write('\n');
    emitData(line);
}

function cookedKey(key: number, name: string | undefined): void {
    if (key === KEY.ENTER || key === KEY.KP_ENTER) { cookedEnter(); return; }
    if (key === KEY.BACKSPACE) {
        if (stdinState.line.length === 0) return;
        stdinState.line = stdinState.line.slice(0, -1);
        eraseCharacter();
        return;
    }
    if (!modifiers.ctrl) return;
    if (name === 'u') {   // kill the line
        while (stdinState.line.length > 0) { stdinState.line = stdinState.line.slice(0, -1); eraseCharacter(); }
    } else if (name === 'd') {   // end of file: an empty line ends the input, otherwise the line is delivered as is
        if (stdinState.line.length === 0) {
            produced.push({ event: 'end', args: [] });
        } else {
            let line = stdinState.line;
            stdinState.line = '';
            emitData(line);
        }
    }
}

function onKey(key: number): void {
    if (isModifier(key)) { trackModifier(key, true); return; }
    if (stdinState.flowing !== true) return;

    let name: string | undefined;
    let s: string | undefined;
    let data: string;
    let special = SPECIAL[key];
    if (special !== undefined) {
        name = special[0];
        let seq = special[1];
        let mods = modifierCode();
        if (name === 'escape' || name === 'return' || name === 'tab' || name === 'backspace') {
            // Escape, Enter, Tab and Backspace send a single character (Shift+Tab is CSI Z).
            if (name === 'tab' && modifiers.shift) data = ESC + '[Z';
            else data = (modifiers.meta ? ESC : '') + seq;
            s = data;
        } else if (seq.charAt(seq.length - 1) === '~') {
            data = ESC + '[' + (mods > 1 ? seq.slice(0, -1) + ';' + mods + '~' : seq);
        } else {
            data = ESC + '[' + (mods > 1 ? '1;' + mods : '') + seq;
        }
    } else if (key >= KEY.F1 && key <= KEY.F12) {
        name = 'f' + (key - KEY.F1 + 1);
        let seq = FUNCTION_KEYS[key - KEY.F1];
        data = seq.charAt(0) === 'O' ? ESC + seq : ESC + '[' + seq;
    } else if (modifiers.ctrl && key >= KEY.A && key <= KEY.Z) {
        // Ctrl+letter: the terminal sends the control character (the computer sends no char event for it).
        name = String.fromCharCode(key + 32);
        data = String.fromCharCode(key - KEY.A + 1);
        s = data;
    } else {
        return; // printable keys arrive as char events
    }

    let keyObject = makeKey(name, data);
    if (stdinState.raw) emitData(data);
    else cookedKey(key, name);
    emitKeypress(s, keyObject);
}

function onChar(ch: string): void {
    if (stdinState.flowing !== true || modifiers.ctrl) return;
    let key = charKey(ch);
    if (stdinState.raw) emitData(key.sequence);
    else cookedText(ch);
    emitKeypress(key.sequence, key);
}

function onPaste(text: string): void {
    if (stdinState.flowing !== true) return;
    if (stdinState.raw) emitData(text);
    else cookedText(text);
    for (let i = 0; i < text.length; i++) {
        let ch = text.charAt(i);
        if (ch === '\n') emitKeypress('\n', makeKey('enter', '\n'));
        else if (ch === '\r') emitKeypress('\r', makeKey('return', '\r'));
        else if (ch === '\t') emitKeypress('\t', makeKey('tab', '\t'));
        else emitKeypress(ch, charKey(ch));
    }
}

/** Run the driver for one input event; it never throws, as an error here would stop the computer. */
function drive(handler: () => void): void {
    produced = [];
    try {
        handler();
    } catch (e) {
        produced = [];
    }
}

// The driver's listeners. They must be registered by the root thread before anything else listens for input, so they
// run first for every event and live forever — the bios loads this module first thing (see internal/globals).
events.on('key', (key: number) => drive(() => onKey(key)));
events.on('key_up', (key: number) => drive(() => { if (isModifier(key)) trackModifier(key, false); }));
events.on('char', (ch: string) => drive(() => onChar(ch)));
events.on('paste', (text: string) => drive(() => onPaste(text)));

// ── stdin listeners ─────────────────────────────────────────────────────────────

const INPUT_EVENTS = ['key', 'key_up', 'char', 'paste'];
const STREAM_EVENTS: Record<string, true> = { data: true, keypress: true, end: true };

/** A listener added with process.stdin.on(...) for a stream event. */
interface Subscription {
    event: string;
    fn: Listener;
    once: boolean;
    active: boolean;
    /** The job that was running when it was added (0: none, i.e. the shell). */
    job: number;
    /** A custom event with a no-op listener, registered in the same thread: its listener count says whether the
     * thread is still alive (listeners of a stopped thread are discarded). */
    probe: string;
    noop: Listener;
    wrapper: Listener;
}

let subscriptions: Subscription[] = [];
let nextSubscription = 1;
let currentJob = 0;

function isAlive(sub: Subscription): boolean {
    return sub.active && events.listenerCount(sub.probe) > 0;
}

function unsubscribe(sub: Subscription): void {
    if (!sub.active) return;
    sub.active = false;
    for (let event of INPUT_EVENTS) events.off(event, sub.wrapper);
    events.off(sub.probe, sub.noop);
    let index = subscriptions.indexOf(sub);
    if (index >= 0) subscriptions.splice(index, 1);
    wakeJob();
}

/** Forget subscriptions whose thread has been stopped. */
function prune(): void {
    let alive: Subscription[] = [];
    for (let sub of subscriptions) if (isAlive(sub)) alive.push(sub); else sub.active = false;
    subscriptions = alive;
}

function subscribe(event: string, fn: Listener, once: boolean): void {
    if (typeof fn !== 'function') throw new TypeError('The "listener" argument must be of type function');
    prune();
    let sub: Subscription = {
        event, fn, once, active: true, job: currentJob,
        probe: 'tty:stdin:' + nextSubscription++,
        noop: () => { /* liveness probe */ },
        wrapper: () => {
            // The driver ran first for this event; deliver what it produced for our event.
            let outputs = produced;
            for (let i = 0; i < outputs.length; i++) {
                if (!sub.active) return;
                if (outputs[i].event !== sub.event) continue;
                if (sub.once) unsubscribe(sub);
                sub.fn.apply(stdin, outputs[i].args);
            }
        },
    };
    for (let input of INPUT_EVENTS) events.on(input, sub.wrapper);
    events.on(sub.probe, sub.noop);
    subscriptions.push(sub);
    // Like Node: adding a 'data' listener starts the flow, unless the stream was paused explicitly.
    if (event === 'data' && stdinState.flowing === null) stdin.resume();
}

const stdinLocal: LocalListeners = {};

const stdin: TtyReadStream = {
    fd: 0,
    isTTY: true,
    readable: true,
    get isRaw() { return stdinState.raw; },
    get readableFlowing() { return stdinState.flowing; },

    setRawMode(mode: boolean) {
        let raw = !!mode;
        if (raw !== stdinState.raw) {
            stdinState.raw = raw;
            stdinState.line = '';
        }
        return stdin;
    },
    pause() {
        if (stdinState.flowing !== false) {
            stdinState.flowing = false;
            term.setCursorBlink(false);
            emitLocal(stdin, stdinLocal, 'pause', []);
            wakeJob();
        }
        return stdin;
    },
    resume() {
        if (stdinState.flowing !== true) {
            stdinState.flowing = true;
            // The cursor blinks while someone reads the terminal.
            term.setCursorBlink(true);
            emitLocal(stdin, stdinLocal, 'resume', []);
        }
        return stdin;
    },
    isPaused() { return stdinState.flowing === false; },
    setEncoding(_encoding?: string) { return stdin; },
    ref() { return stdin; },
    unref() { return stdin; },

    on(event: string, listener: Listener) {
        if (STREAM_EVENTS[event]) subscribe(event, listener, false); else addLocal(stdinLocal, event, listener);
        return stdin;
    },
    addListener(event: string, listener: Listener) { return stdin.on(event, listener); },
    once(event: string, listener: Listener) {
        if (STREAM_EVENTS[event]) { subscribe(event, listener, true); return stdin; }
        let wrapper = function (this: unknown) {
            let args: unknown[] = Array.prototype.slice.call(arguments);
            removeLocal(stdinLocal, event, wrapper);
            listener.apply(this, args);
        };
        addLocal(stdinLocal, event, wrapper);
        return stdin;
    },
    off(event: string, listener: Listener) {
        if (!STREAM_EVENTS[event]) { removeLocal(stdinLocal, event, listener); return stdin; }
        for (let i = subscriptions.length - 1; i >= 0; i--) {
            let sub = subscriptions[i];
            if (sub.event === event && sub.fn === listener) { unsubscribe(sub); break; }
        }
        return stdin;
    },
    removeListener(event: string, listener: Listener) { return stdin.off(event, listener); },
    /** Removes the listeners added by the current job (a program cannot remove the shell's). */
    removeAllListeners(event?: string) {
        for (let sub of subscriptions.slice()) {
            if (sub.job === currentJob && (event === undefined || sub.event === event)) unsubscribe(sub);
        }
        if (event === undefined) { for (let key of Object.keys(stdinLocal)) delete stdinLocal[key]; }
        else delete stdinLocal[event];
        return stdin;
    },
    emit(event: string) {
        let args: unknown[] = Array.prototype.slice.call(arguments, 1);
        if (!STREAM_EVENTS[event]) return emitLocal(stdin, stdinLocal, event, args);
        // Deliver directly to the listeners (from the calling thread, so they cannot block here).
        prune();
        let any = false;
        for (let sub of subscriptions.slice()) {
            if (sub.event !== event || !sub.active) continue;
            any = true;
            if (sub.once) unsubscribe(sub);
            sub.fn.apply(stdin, args);
        }
        return any;
    },
    listenerCount(event: string): number {
        if (!STREAM_EVENTS[event]) return (stdinLocal[event] ?? []).length;
        prune();
        let count = 0;
        for (let sub of subscriptions) if (sub.event === event) count++;
        return count;
    },
};

// ── Job control (used by the shell) ─────────────────────────────────────────────

const EXIT_SIGNAL = '__ccProcessExit';

interface Job {
    id: number;
    parent: number;
    saved: StdinState;
    blink: boolean;
    exiting: boolean;
    exitCode: number;
    wake: (() => void) | null;
}

let nextJob = 1;
let jobs: Job[] = [];

function findJob(id: number): Job | undefined {
    for (let job of jobs) if (job.id === id) return job;
    return undefined;
}

function wakeJob(): void {
    let job = findJob(currentJob);
    if (job !== undefined && job.wake !== null) job.wake();
}

/**
 * Start a job (a program run by the shell): it gets a fresh stdin — cooked, and not flowing until it reads — and the
 * cursor is hidden until it reads input. The shell's terminal state is restored by endJob().
 */
function beginJob(): Job {
    let job: Job = {
        id: nextJob++, parent: currentJob,
        saved: { raw: stdinState.raw, flowing: stdinState.flowing, line: stdinState.line },
        blink: term.getCursorBlink(),
        exiting: false, exitCode: 0, wake: null,
    };
    jobs.push(job);
    currentJob = job.id;
    stdinState.raw = false;
    stdinState.flowing = null;
    stdinState.line = '';
    term.setCursorBlink(false);
    return job;
}

/** Whether the job still reads stdin: it has live stdin listeners and has not paused stdin. */
function jobReading(job: Job): boolean {
    if (stdinState.flowing === false) return false;
    prune();
    for (let sub of subscriptions) if (sub.job === job.id) return true;
    return false;
}

/**
 * Called by the job's thread once its main code has returned: block while the job still reads stdin (Node keeps a
 * process alive while stdin is flowing). Throws the exit signal if the job called process.exit(). Ctrl+T reaches the
 * wait like any blocking call.
 */
function waitForJob(job: Job): void {
    while (!job.exiting && jobReading(job)) {
        let timer = -1;
        let onTimer = (id: number) => { if (id === timer && job.wake !== null) job.wake(); };
        let promise = new Promise<void>((resolve) => { job.wake = () => resolve(); });
        // Re-check now and then: a listener of a stopped thread disappears without telling us.
        timer = system.startTimer(1);
        events.on('timer', onTimer);
        try {
            asyncMod.unwrap(promise);
        } finally {
            job.wake = null;
            events.off('timer', onTimer);
            system.cancelTimer(timer);
        }
    }
    if (job.exiting) throw exitSignal(job.exitCode);
}

/** End a job: close the stdin listeners it left behind and restore the terminal state saved by beginJob(). */
function endJob(job: Job): void {
    for (let sub of subscriptions.slice()) if (sub.job === job.id) unsubscribe(sub);
    let index = jobs.indexOf(job);
    if (index >= 0) jobs.splice(index, 1);
    currentJob = job.parent;
    stdinState.raw = job.saved.raw;
    stdinState.flowing = job.saved.flowing;
    stdinState.line = job.saved.line;
    term.setCursorBlink(job.blink);
}

/** The id of the running job, or 0 outside of jobs. */
function jobId(): number { return currentJob; }

function exitSignal(code: number): Error {
    let err = new Error('process.exit(' + code + ')');
    Object.defineProperty(err, EXIT_SIGNAL, { value: code });
    return err;
}

/** The exit code if `e` is the signal thrown by process.exit(), otherwise undefined. */
function exitCodeOf(e: unknown): number | undefined {
    if (e !== null && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, EXIT_SIGNAL)) {
        return (e as any)[EXIT_SIGNAL] as number;
    }
    return undefined;
}

/**
 * process.exit(): end the running job with `code`. Returns the signal to throw, which unwinds the job's code; the
 * job also ends if the signal is caught (or thrown in a background thread), as waitForJob() checks the flag.
 */
function requestExit(code: number): Error {
    let job = findJob(currentJob);
    if (job !== undefined) {
        job.exiting = true;
        job.exitCode = code;
        if (job.wake !== null) job.wake();
    }
    return exitSignal(code);
}

export = {
    stdout,
    stderr,
    stdin,
    CSI,
    beginJob,
    waitForJob,
    endJob,
    jobId,
    requestExit,
    exitCodeOf,
};
