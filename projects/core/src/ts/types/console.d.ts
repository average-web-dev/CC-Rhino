// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `console` — Node's console (ROM module /rom/lib/console). A global, and also `require("console")` (the same object,
// whose `Console` property is the class).

/** A stream a Console writes to. */
type ConsoleStream = Writable;

interface ConsoleOptions {
    stdout: ConsoleStream;
    stderr?: ConsoleStream;
    /** Ignore errors thrown by the streams' write (default true). */
    ignoreErrors?: boolean;
    /** Options for util.inspect; by default lines break at the stream's width. */
    inspectOptions?: InspectOptions;
    /** Spaces added per console.group() (default 2). */
    groupIndentation?: number;
}

interface Console {
    /** Print to stdout, formatted like util.format (`%s %d %i %f %j %o %O %c %%`). */
    log(...data: unknown[]): void;
    info(...data: unknown[]): void;
    debug(...data: unknown[]): void;
    dirxml(...data: unknown[]): void;
    /** Print to stderr (red on colour terminals). */
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
    /** Print util.inspect(object, options) to stdout. */
    dir(object: unknown, options?: InspectOptions): void;
    /** Print "Trace: message" and the current stack to stderr. */
    trace(...data: unknown[]): void;
    /** Print "Assertion failed[: …]" to stderr unless `value` is truthy. */
    assert(value: unknown, ...data: unknown[]): void;
    /** Clear the terminal and move the cursor to the top left. */
    clear(): void;
    count(label?: string): void;
    countReset(label?: string): void;
    group(...label: unknown[]): void;
    groupCollapsed(...label: unknown[]): void;
    groupEnd(): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    timeLog(label?: string, ...data: unknown[]): void;
    /** Print an array or object (or Map/Set) as a table, drawn with ASCII characters. */
    table(tabularData: unknown, properties?: string[]): void;
}

interface ConsoleConstructor {
    new(options: ConsoleOptions): Console;
    new(stdout: ConsoleStream, stderr?: ConsoleStream, ignoreErrors?: boolean): Console;
    (options: ConsoleOptions): Console;
    readonly prototype: Console;
}

interface GlobalConsole extends Console {
    readonly Console: ConsoleConstructor;
}

declare var console: GlobalConsole;

declare function require(id: "console"): GlobalConsole;
declare function require(id: "node:console"): GlobalConsole;
declare module "console" { const console: GlobalConsole; export = console; }
declare module "node:console" { const console: GlobalConsole; export = console; }
