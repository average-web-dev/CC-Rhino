// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `process` — Node's process object, for what a computer has (ROM module /rom/lib/process). A global, and also
// `require("process")` (the same object).

declare function BigInt(value: number | string): bigint;

/** Anything with a Node-style `write(chunk, [encoding], [callback])`. */
interface Writable {
    write(chunk: string | Uint8Array, encoding?: string | ((err: Error | null) => void), callback?: (err: Error | null) => void): boolean;
    readonly isTTY?: boolean;
    readonly columns?: number;
    readonly rows?: number;
    /** Whether the stream shows colours (a colour TTY). */
    hasColors?(count?: number): boolean;
    on?(event: string, listener: (...args: any[]) => void): unknown;
    removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

/** A readable source of terminal input: `'data'` events (a TTY stream also has `'keydown'` / `'keyup'`). */
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
     * CC extension: the color index `index` (0–15) shows on the device (see Term.setPaletteColor), or `undefined` for
     * a virtual TTY.
     */
    getPaletteColor(index: number): Color | undefined;
    /**
     * `'resize'` fires when the TTY changes its size (the native `tty_resize` event: a monitor that grew or changed its
     * text scale, a virtual TTY given a new size; the consoles of the screen never change size). Its listeners belong
     * to the calling thread, like `events.on` listeners. Other events are accepted but never fired.
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
 * process.stdin: the program's TTY (the keyboard) as a Node `tty.ReadStream`.
 *
 * - `'data'`: in cooked mode (the default) the TTY's line discipline echoes what is typed, handles Backspace / Ctrl+U
 *   and delivers whole lines including `"\n"`; Ctrl+D on an empty line emits `'end'` (the stream stays usable, like a
 *   terminal). In raw mode (`setRawMode(true)`) every key is delivered as the characters a VT terminal sends.
 * - `'keydown'` / `'keyup'` (CC extension, like the browser's; instead of Node's `'keypress'`): a TtyKeyInput for each
 *   key in the delivered input (in cooked mode only what the line discipline passes on), in the order typed across
 *   listeners. In raw mode the terminal reports every key with its releases and repeats (the kitty keyboard protocol;
 *   `setKeyboardProtocol('legacy')` turns that off), while `'data'` still gets keys as a terminal traditionally sends
 *   them.
 * - `'mouse'` (CC extension): a TtyMouseInput for each mouse report, once the program asked for them
 *   (`CSI.mouse(true)`); until then the mouse belongs to the terminal (the middle button pastes).
 * - `'paste'` (CC extension): a TtyPasteInput for each paste, once the program asked for bracketed paste
 *   (`CSI.bracketedPaste(true)`; readline does); otherwise pasted text (Ctrl+Shift+V, Shift+Insert, middle button)
 *   arrives as typed text.
 * - Nothing is delivered until the stream flows: adding a `'data'` listener or calling `resume()` starts it, `pause()`
 *   stops it. Input typed meanwhile stays in the TTY (type ahead) and is delivered when it flows again.
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
    on(event: "keydown" | "keyup", listener: (event: TtyKeyInput) => void): this;
    on(event: "mouse", listener: (event: TtyMouseInput) => void): this;
    on(event: "paste", listener: (event: TtyPasteInput) => void): this;
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

/**
 * `process` always means the calling program: each program (started by the shell or child_process) has its own TTY,
 * argv, working directory and exit code. Outside of a program (the bios, the OS layer) it is the computer's root
 * process on the first console.
 */
interface Process {
    /** The program's TTY: its stdin, stdout and stderr. */
    readonly stdin: TtyReadStream;
    readonly stdout: TtyWriteStream;
    readonly stderr: TtyWriteStream;
    /** `["bash", "/path/to/program.js", ...args]` for a program (`argv.slice(2)` are its arguments). */
    argv: string[];
    readonly argv0: string;
    execArgv: string[];
    /**
     * Environment variables: a live view of the `env` module; shared by all programs. `PATH` lists the program
     * directories (not `require.paths`, the module search path).
     */
    env: Record<string, string | undefined>;
    readonly platform: "computercraft";
    /** The id of the running program (0 outside of a program). */
    readonly pid: number;
    /** The id of the program that started it (0: the OS). */
    readonly ppid: number;
    /** Exit code of the running program; set by `exit(code)`. */
    exitCode: number | undefined;
    /** The program's working directory (a child starts in its parent's; chdir() does not move the parent). */
    cwd(): string;
    /** Change the working directory; throws ENOENT / ENOTDIR like Node. */
    chdir(directory: string): void;
    /**
     * End the running program with `code` (default `exitCode`, else 0). It throws a signal that unwinds the program,
     * which the shell catches; outside of a program (shell, bios) it shuts the computer down.
     */
    exit(code?: number): never;
    /**
     * Send a signal to the program `pid` (see system.processes()): Signal.SIGTERM (the default, exit code 143,
     * "Terminated"), Signal.SIGINT (130, "Interrupted") or Signal.SIGKILL (137, "Killed"; its process.on('exit')
     * listeners do not run), from `system`; as in Node, the names ('SIGTERM') work too. It ends at once, wherever it is
     * blocked. Signal 0 only checks that `pid` runs. Throws ESRCH if there is no such program, EPERM for the root
     * process (pid 0), ERR_UNKNOWN_SIGNAL for others.
     */
    kill(pid: number, signal?: Signal | SignalName | 0): true;
    /**
     * Call `listener` with the exit code when the program has ended (its code returned and nothing keeps it alive,
     * process.exit(), a failure or Ctrl+C), as in Node. Listeners run synchronously, before the TTY is restored (raw
     * mode, mouse, bracketed paste, the alternate screen; that needs no listener); they may set `exitCode` or call
     * `exit(code)` to change the code. 'exit' is the only event (signals end a program, see kill()).
     */
    on(event: "exit", listener: (code: number) => void): this;
    addListener(event: "exit", listener: (code: number) => void): this;
    once(event: "exit", listener: (code: number) => void): this;
    off(event: "exit", listener: (code: number) => void): this;
    removeListener(event: "exit", listener: (code: number) => void): this;
    listenerCount(event: "exit"): number;
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
