// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `util` — the parts of Node's util that are meaningful here (ROM module /rom/lib/util).

interface InspectOptions {
    /** Include non-enumerable properties (default false). */
    showHidden?: boolean;
    /** How many levels to recurse into (default 2; null or Infinity: all). */
    depth?: number | null;
    /** Accepted for compatibility; inspect never colours its output. */
    colors?: boolean;
    /** Call `value[util.inspect.custom](depth, options, inspect)` when present (default true). */
    customInspect?: boolean;
    showProxy?: boolean;
    /** Array / Set / Map elements shown (default 100). */
    maxArrayLength?: number | null;
    /** Characters of a string shown (default 10000). */
    maxStringLength?: number | null;
    /** Line length at which entries are split over several lines (default 80). */
    breakLength?: number;
    /** false/number: how many inner levels are combined on one line (default 3); true: as few lines as possible. */
    compact?: boolean | number;
    sorted?: boolean | ((a: string, b: string) => number);
    /** Show getter values (default false: `[Getter]`). */
    getters?: boolean;
}

interface InspectFunction {
    (value: unknown, options?: InspectOptions): string;
    (value: unknown, showHidden?: boolean, depth?: number | null, colors?: boolean): string;
    /** Symbol.for('nodejs.util.inspect.custom'). */
    readonly custom: symbol;
    defaultOptions: InspectOptions;
}

interface PromisifyFunction {
    <T = any>(original: (...args: any[]) => void): (...args: any[]) => Promise<T>;
    /** Symbol.for('nodejs.util.promisify.custom'). */
    readonly custom: symbol;
}

/** Style names accepted by util.styleText (colours map onto the terminal's 16 colours; modifiers have no effect). */
type StyleName =
    | "reset" | "bold" | "dim" | "italic" | "underline" | "blink" | "inverse" | "hidden" | "strikethrough"
    | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray" | "grey"
    | "blackBright" | "redBright" | "greenBright" | "yellowBright" | "blueBright" | "magentaBright" | "cyanBright"
    | "whiteBright"
    | "bgBlack" | "bgRed" | "bgGreen" | "bgYellow" | "bgBlue" | "bgMagenta" | "bgCyan" | "bgWhite" | "bgGray"
    | "bgGrey" | "bgBlackBright" | "bgRedBright" | "bgGreenBright" | "bgYellowBright" | "bgBlueBright"
    | "bgMagentaBright" | "bgCyanBright" | "bgWhiteBright";

interface UtilModule {
    /** printf-like formatting: `%s %d %i %f %j %o %O %c %%`; extra arguments are appended (inspected unless strings). */
    format(format?: unknown, ...args: unknown[]): string;
    formatWithOptions(inspectOptions: InspectOptions, format?: unknown, ...args: unknown[]): string;
    /** A string representation of any value, for debugging (circular references, depth limit, line breaking). */
    inspect: InspectFunction;
    /** Make `constructor.prototype` inherit from `superConstructor.prototype` (legacy). */
    inherits(constructor: Function, superConstructor: Function): void;
    /** Turn a function taking an error-first callback as its last argument into one returning a Promise. */
    promisify: PromisifyFunction;
    /** Remove ANSI escape sequences. */
    stripVTControlCharacters(str: string): string;
    /** Wrap `text` in the ANSI codes of one or more styles, e.g. `styleText("red", "error")`. */
    styleText(format: StyleName | StyleName[], text: string): string;
    /** Deep strict equality of two values. */
    isDeepStrictEqual(a: unknown, b: unknown): boolean;
}

declare function require(id: "util"): UtilModule;
declare function require(id: "node:util"): UtilModule;
declare module "util" { const util: UtilModule; export = util; }
