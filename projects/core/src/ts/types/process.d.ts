// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `process` — Node's process object, for what a computer has (ROM module /rom/lib/process). A global, and also
// `require("process")` (the same object).

declare function BigInt(value: number | string): bigint;

/** A key as reported by `'keypress'` events (Node's readline key object). */
interface Key {
    /** The characters the terminal sends for the key (`"\r"`, `"\x1b[A"`, `"a"`, …). */
    sequence: string;
    /** Key name: `"a"`–`"z"`, `"0"`–`"9"`, `"return"`, `"enter"`, `"backspace"`, `"tab"`, `"up"`, `"f1"`, …. */
    name: string | undefined;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
}

/** Anything with a Node-style `write(chunk, [encoding], [callback])`. */
interface Writable {
    write(chunk: string | Uint8Array, encoding?: string | ((err: Error | null) => void), callback?: (err: Error | null) => void): boolean;
    readonly isTTY?: boolean;
    readonly columns?: number;
    readonly rows?: number;
    on?(event: string, listener: (...args: any[]) => void): unknown;
    removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

/** A readable source of terminal input: `'data'` (and, in terminal mode, `'keypress'`) events. */
interface ReadableInput {
    on(event: string, listener: (...args: any[]) => void): unknown;
    removeListener(event: string, listener: (...args: any[]) => void): unknown;
    listenerCount(event: string): number;
    emit?(event: string, ...args: any[]): boolean;
    pause?(): unknown;
    resume?(): unknown;
    setRawMode?(mode: boolean): unknown;
    readonly isRaw?: boolean;
    readonly isTTY?: boolean;
}

/**
 * process.stdout / process.stderr: the terminal as a Node `tty.WriteStream`. Text wraps at the right edge and scrolls;
 * `\n \r \t \b` and ANSI escape sequences (SGR colours mapped onto the 16 CC colours, cursor movement and erasing)
 * are interpreted. stderr writes in red on colour terminals.
 */
interface TtyWriteStream extends Writable {
    readonly fd: number;
    readonly isTTY: true;
    readonly writable: boolean;
    /** Width of the terminal. */
    readonly columns: number;
    /** Height of the terminal. */
    readonly rows: number;
    cursorTo(x: number, y?: number, callback?: () => void): boolean;
    cursorTo(x: number, callback: () => void): boolean;
    moveCursor(dx: number, dy: number, callback?: () => void): boolean;
    /** -1: left of the cursor, 1: right of it, 0: the whole line. */
    clearLine(dir: -1 | 0 | 1 | number, callback?: () => void): boolean;
    clearScreenDown(callback?: () => void): boolean;
    getWindowSize(): [number, number];
    hasColors(count?: number | object): boolean;
    getColorDepth(): number;
    /**
     * `'resize'` fires on the `term_resize` event. The computer's own terminal never changes size, so it only fires when
     * ROM code emits `term_resize` (e.g. a future window/multishell layer); other events are accepted but never fired.
     */
    on(event: string, listener: (...args: any[]) => void): this;
    addListener(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: any[]): boolean;
    listenerCount(event: string): number;
}

/**
 * process.stdin: the keyboard as a Node `tty.ReadStream`.
 *
 * - `'data'`: in cooked mode (the default) a line discipline echoes what is typed, handles Backspace / Ctrl+U and
 *   delivers whole lines including `"\n"`; Ctrl+D on an empty line emits `'end'` (the stream stays usable, like a
 *   terminal). In raw mode (`setRawMode(true)`) every key is delivered as the characters a VT terminal sends.
 * - `'keypress'`: `(sequence, key)` for every key, in both modes.
 * - Nothing is read (or echoed) until the stream flows: adding a `'data'` listener or calling `resume()` starts it,
 *   `pause()` stops it. Input arriving meanwhile is dropped (there is no type-ahead buffer).
 * - Listeners belong to the thread that adds them: they may block, and are dropped when the program is stopped. A
 *   program run by the shell keeps running while it has stdin listeners and stdin is not paused (as a Node process
 *   does); the shell closes them when the program ends.
 */
interface TtyReadStream extends ReadableInput {
    readonly fd: number;
    readonly isTTY: true;
    readonly readable: boolean;
    readonly isRaw: boolean;
    /** null until someone reads, true while flowing, false once paused. */
    readonly readableFlowing: boolean | null;
    setRawMode(mode: boolean): this;
    pause(): this;
    resume(): this;
    isPaused(): boolean;
    /** Data is always delivered as strings; accepted for compatibility. */
    setEncoding(encoding?: string): this;
    ref(): this;
    unref(): this;
    on(event: "data", listener: (chunk: string) => void): this;
    on(event: "keypress", listener: (sequence: string | undefined, key: Key) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    addListener(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    /** Removes the listeners added by the running program (a program cannot remove the shell's). */
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: any[]): boolean;
    listenerCount(event: string): number;
}

interface Process {
    readonly stdin: TtyReadStream;
    readonly stdout: TtyWriteStream;
    readonly stderr: TtyWriteStream;
    /** `["bash", "/path/to/program.js", ...args]` while the shell runs a program (`argv.slice(2)` are its arguments). */
    argv: string[];
    argv0: string;
    execArgv: string[];
    /** Environment variables: a live view of the `env` module (`PATH` mirrors `require.paths`). */
    env: Record<string, string | undefined>;
    readonly platform: "computercraft";
    /** Exit code of the running program; set by `exit(code)`. */
    exitCode: number | undefined;
    /** The working directory (the shell's, saved and restored around each program). */
    cwd(): string;
    /** Change the working directory; throws ENOENT / ENOTDIR like Node. */
    chdir(directory: string): void;
    /**
     * End the running program with `code` (default `exitCode`, else 0). It throws a signal that unwinds the program,
     * which the shell catches; outside of a program (shell, bios) it shuts the computer down.
     */
    exit(code?: number): never;
    /** Run `callback` as a microtask. */
    nextTick<A extends unknown[]>(callback: (...args: A) => void, ...args: A): void;
    /** `[seconds, nanoseconds]` (millisecond resolution), optionally relative to an earlier value. */
    hrtime: {
        (previous?: [number, number]): [number, number];
        bigint(): bigint;
    };
    /** Seconds since the computer started. */
    uptime(): number;
    /** Print `"<type>: <message>"` to stderr. */
    emitWarning(warning: string | Error, type?: string): void;
}

declare var process: Process;

declare function require(id: "process"): Process;
declare function require(id: "node:process"): Process;
declare module "process" { const process: Process; export = process; }
declare module "node:process" { const process: Process; export = process; }
