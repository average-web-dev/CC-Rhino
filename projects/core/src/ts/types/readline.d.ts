// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `readline` and `readline/promises` — Node's readline (ROM modules /rom/lib/readline, /rom/lib/readline/promises).

/** `[completions, the substring they complete]`. */
type CompleterResult = [string[], string];

/** Sync (`line => result`), promise-returning or callback (`(line, cb) => void`) completer. */
type Completer =
    | ((line: string) => CompleterResult | Promise<CompleterResult>)
    | ((line: string, callback: (err: Error | null, result?: CompleterResult) => void) => void);

interface InterfaceOptions {
    input: ReadableInput;
    output?: Writable | null;
    completer?: Completer;
    /** Edit lines on a terminal (keypress events, raw mode); default: `output.isTTY`. */
    terminal?: boolean;
    /** Initial history, newest first. */
    history?: string[];
    /** Maximum history length (default 30; 0 disables history). */
    historySize?: number;
    removeHistoryDuplicates?: boolean;
    /** Default "> ". */
    prompt?: string;
    crlfDelay?: number;
    tabSize?: number;
}

interface CursorPos { rows: number; cols: number; }

interface ReadlineEventEmitter {
    on(event: "line", listener: (line: string) => void): this;
    on(event: "close" | "pause" | "resume" | "SIGINT", listener: () => void): this;
    on(event: "history", listener: (history: string[]) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    addListener(event: string | symbol, listener: (...args: any[]) => void): this;
    prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    listenerCount(event: string | symbol): number;
    listeners(event: string | symbol): ((...args: any[]) => void)[];
    eventNames(): (string | symbol)[];
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
}

interface InterfaceBase extends ReadlineEventEmitter, AsyncIterable<string> {
    input: ReadableInput;
    output: Writable | null | undefined;
    terminal: boolean;
    /** The line being edited. */
    line: string;
    /** Cursor position within `line`. */
    cursor: number;
    /** Past lines, newest first. */
    history: string[];
    historySize: number;
    historyIndex: number;
    removeHistoryDuplicates: boolean;
    crlfDelay: number;
    tabSize: number;
    completer: Completer | undefined;
    isCompletionEnabled: boolean;
    closed: boolean;
    paused: boolean;
    readonly columns: number;
    setPrompt(prompt: string): void;
    getPrompt(): string;
    /** Show the prompt (and the line being edited); resumes a paused interface. */
    prompt(preserveCursor?: boolean): void;
    /** Pause input; a paused interface ignores input. */
    pause(): this;
    resume(): this;
    /** Insert `data` as if typed, or simulate a key (`rl.write(null, { ctrl: true, name: "u" })`). */
    write(data: string | null | undefined, key?: Partial<Key>): void;
    getCursorPos(): CursorPos;
    /** Move below the line being edited and start a new, empty one (without emitting 'line'). */
    clearLine(): void;
    /** Close: restores cooked mode, removes the input listeners, emits 'close'. */
    close(): void;
}

interface Interface extends InterfaceBase {
    /**
     * Show `query` and read one line. Without a callback this **blocks** the calling thread and returns the answer
     * (throws an AbortError if the interface is closed meanwhile); with one it returns at once, as in Node.
     */
    question(query: string, options?: object): string;
    question(query: string, callback: (answer: string) => void): void;
    question(query: string, options: object, callback: (answer: string) => void): void;
}

interface InterfaceConstructor {
    new(options: InterfaceOptions): Interface;
    new(input: ReadableInput, output?: Writable | null, completer?: Completer, terminal?: boolean): Interface;
    readonly prototype: Interface;
}

interface ReadlineModule {
    Interface: InterfaceConstructor;
    createInterface(options: InterfaceOptions): Interface;
    createInterface(input: ReadableInput, output?: Writable | null, completer?: Completer, terminal?: boolean): Interface;
    /** Move the cursor (writes VT sequences to `stream`). */
    cursorTo(stream: Writable | null | undefined, x: number, y?: number, callback?: () => void): boolean;
    moveCursor(stream: Writable | null | undefined, dx: number, dy: number, callback?: () => void): boolean;
    clearLine(stream: Writable | null | undefined, dir: number, callback?: () => void): boolean;
    clearScreenDown(stream: Writable | null | undefined, callback?: () => void): boolean;
    /** Make a stream that emits terminal input as 'data' also emit 'keypress' (process.stdin already does). */
    emitKeypressEvents(stream: ReadableInput, iface?: unknown): void;
    readonly promises: ReadlinePromisesModule;
}

interface PromisesInterface extends InterfaceBase {
    /** Show `query` and resolve with the next line (rejects with an AbortError if the interface is closed). */
    question(query: string, options?: object): Promise<string>;
}

interface PromisesInterfaceConstructor {
    new(options: InterfaceOptions): PromisesInterface;
    new(input: ReadableInput, output?: Writable | null, completer?: Completer, terminal?: boolean): PromisesInterface;
    readonly prototype: PromisesInterface;
}

interface ReadlinePromisesModule {
    Interface: PromisesInterfaceConstructor;
    createInterface(options: InterfaceOptions): PromisesInterface;
    createInterface(input: ReadableInput, output?: Writable | null, completer?: Completer, terminal?: boolean): PromisesInterface;
}

declare function require(id: "readline"): ReadlineModule;
declare function require(id: "node:readline"): ReadlineModule;
declare function require(id: "readline/promises"): ReadlinePromisesModule;
declare function require(id: "node:readline/promises"): ReadlinePromisesModule;
declare module "readline" { const readline: ReadlineModule; export = readline; }
declare module "readline/promises" { const readlinePromises: ReadlinePromisesModule; export = readlinePromises; }
