// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Runtime globals. `require` is installed by the engine; the bios adds the Node-style `process` and `console`
// (declared in process.d.ts / console.d.ts).

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

// --- Global timer functions (Node-style, layered on the CC timer mechanism) ---

declare function setTimeout(cb: () => void, ms: number): number;
declare function setInterval(cb: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;

/** Block the current script for `seconds` (CC extension; deliberately absent in Node). */
declare function sleep(seconds: number): void;
