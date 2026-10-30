// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `tty` — Node's tty module for CC TTYs (ROM module /rom/lib/tty), and the engine-internal `internal/pty` module behind
// it (its interfaces are generated from Java: PtyAPI, TtyHandle, PipeHandle).

/** Options for a tty.ReadStream (used by process.stdin). */
interface TtyReadStreamOptions {
    /** Who adds listeners now (the running job): removeAllListeners() only removes the current owner's. */
    owner?: () => number;
    /** Called when the stream starts (true) or stops (false) flowing. */
    onFlowing?: (flowing: boolean) => void;
}

/** A tty.ReadStream: what programs read from a TTY. */
interface TtyStdin extends TtyReadStream {
    /** Set readableFlowing directly (job control: a fresh stdin for a program). */
    setFlowing(value: boolean | null): void;
    /** Drop what was typed but not read yet. */
    discard(): void;
    /** Wait until input is available and return it, or `undefined` at end of input (used by Term). */
    readSync(): string | undefined;
    /** Remove the stream listeners added by `owner`. */
    removeListenersOf(owner: number): void;
}

/**
 * A TTY: `stdin` (what programs read; input() types into it), `stdout` / `stderr` (what programs write; for a virtual
 * TTY, readOutput() / readErrorOutput() read it).
 */
interface TTY {
    readonly stdin: TtyStdin;
    readonly stdout: TtyWriteStream;
    readonly stderr: TtyWriteStream;
    /** The native TTY. */
    readonly handle: TtyHandle;
    readonly columns: number;
    readonly rows: number;
    readonly isRaw: boolean;
    setRawMode(mode: boolean): this;
    isColor(): boolean;
    /** Resize a virtual TTY. */
    setSize(columns: number, rows: number): void;
    /** What programs write to `stdout` (a virtual TTY): blocks until there is some; `undefined` once it ended. */
    readOutput(): string | undefined;
    /** What programs write to `stderr` (a virtual TTY). */
    readErrorOutput(): string | undefined;
    /** Type into the TTY: the text passes its line discipline, as if typed. */
    input(text: string): void;
    /** The cursor column of the device showing this TTY (0 at the start of a line), or undefined for a virtual one. */
    cursorColumn(): number | undefined;
}

interface TTYConstructor {
    /** A virtual TTY (not shown anywhere), default 51 × 19. */
    new (columns?: number, rows?: number, options?: TtyReadStreamOptions): TTY;
    readonly prototype: TTY;
    /** Wrap a native TTY (`monitor.getTty()`, `require('screen').getConsole(n)`). */
    from(handle: TtyHandle, options?: TtyReadStreamOptions): TTY;
}

/** The escape sequences a TTY understands. */
interface TtyEscapes {
    /** Show the (blinking) cursor. */
    readonly showCursor: string;
    /** Hide the cursor. */
    readonly hideCursor: string;
    /** Clear the whole screen (the cursor stays). */
    readonly clearScreen: string;
    /** Move the cursor to the top left. */
    readonly home: string;
    /** Back to the default colours. */
    readonly reset: string;
    /** Select CC colours (powers of two, as `colors`): text, and optionally background. */
    color(fg: number, bg?: number): string;
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): string;
    /** Write `text` with one text and one background colour (blit digits) per character, without wrapping. */
    blit(text: string, fg: string, bg: string): string;
    /** Ask for mouse reports in stdin (SGR encoding, presses, releases and drags), or stop them. */
    mouse(on: boolean): string;
    cursorTo(x: number, y?: number): string;
    moveCursor(dx: number, dy: number): string;
    /** -1: left of the cursor, 1: right of it, 0: the whole line. */
    clearLine(dir: number): string;
    readonly clearScreenDown: string;
}

interface TtyModule {
    TTY: TTYConstructor;
    ReadStream: { new (tty: TtyHandle, options?: TtyReadStreamOptions): TtyStdin; readonly prototype: TtyStdin };
    WriteStream: { new (tty: TtyHandle, pipe: PipeHandle, fd: number): TtyWriteStream; readonly prototype: TtyWriteStream };
    CSI: TtyEscapes;
    /** A CC colour (a power of two, 1 … 32768) as its blit index (0 = white … 15 = black); RangeError otherwise. */
    colourIndex(colour: number, argument?: string): number;
    /** Whether `fd` is a TTY: process.stdin/stdout/stderr (0, 1, 2) always are. */
    isatty(fd: number): boolean;
}

declare function require(id: "tty"): TtyModule;
declare function require(id: "node:tty"): TtyModule;
declare module "tty" { const tty: TtyModule; export = tty; }
declare module "node:tty" { const tty: TtyModule; export = tty; }

declare module "internal/pty" { const pty: PtyAPI; export = pty; }
declare module "internal/pty/promises" { const ptyPromises: PtyAPIPromises; export = ptyPromises; }

interface CustomEventMap {
    /** The last program running on a TTY ended (emitted by the ROM's job control; `tty` is the native TTY id). */
    tty_released: [tty: number];
}
