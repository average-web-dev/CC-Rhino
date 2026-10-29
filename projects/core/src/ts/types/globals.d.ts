// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Runtime globals. `require` is installed by the engine; the bios adds the Node-style `process` and `console`
// (declared in process.d.ts / console.d.ts) and the timer functions (timers.d.ts).

// --- CommonJS ---

/** Load a built-in API module by name, returning its typed surface. */
declare function require(id: "path"): PathModule;
declare function require(id: "env"): EnvModule;
declare function require(id: "parallel"): ParallelModule;
declare function require(id: "parallel/promises"): ParallelPromisesModule;
declare function require(id: "async"): AsyncModule;
/** Load a user/ROM module (e.g. `require("/startup")`). */
declare function require(id: string): unknown;

declare namespace require {
    /** Module search paths checked when resolving bare module ids. */
    let paths: string[];
    /**
     * Load a module without consulting or populating the module cache: its top-level code runs again on every
     * call and always sees the current file contents. Used to run programs; libraries should use `require`.
     */
    function uncached(id: string): unknown;
    /**
     * Resolve a module id to its absolute path (or the id itself for native modules) without executing it.
     * Throws `MODULE_NOT_FOUND` if there is no such module.
     */
    function resolve(id: string): string;
    /** Cache of resolved modules; key is the absolute path, value is `module.exports`. */
    const cache: Record<string, unknown>;
}

declare const module: { exports: unknown };
declare const exports: unknown;

// Timers (`setTimeout`, `setInterval`, `setImmediate`, their clear* functions and `queueMicrotask`) are globals too,
// declared in timers.d.ts. There is no global `sleep`: use `require("system").sleep(ticks)` (blocking, in game ticks)
// or `require("timers/promises").setTimeout(ms)`.
