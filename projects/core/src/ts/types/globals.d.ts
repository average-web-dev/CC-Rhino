// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Runtime globals. Per the migration design, `require` is the only API entry point;
// timers and `sleep` are the few additional globals (Node-style).

// --- CommonJS ---

/** Load a built-in API module by name, returning its typed surface. */
declare function require(id: "fs"): FsModule;
declare function require(id: "path"): PathModule;
declare function require(id: "process"): ProcessModule;
declare function require(id: "events"): EventsModule;
declare function require(id: "http"): HttpModule;
declare function require(id: "term"): TermModule;
declare function require(id: "redstone"): RedstoneModule;
declare function require(id: "rs"): RedstoneModule;
declare function require(id: "peripheral"): PeripheralModule;
declare function require(id: "turtle"): TurtleModule;
declare function require(id: "commands"): CommandsModule;
declare function require(id: "pocket"): PocketModule;
/** Load a user/ROM module (e.g. `require("/startup")`). */
declare function require(id: string): unknown;

declare const module: { exports: unknown };
declare const exports: unknown;

// --- Global timer functions (Node-style, layered on the CC timer mechanism) ---

declare function setTimeout(cb: () => void, ms: number): number;
declare function setInterval(cb: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;

/** Block the current script for `seconds` (CC extension; deliberately absent in Node). */
declare function sleep(seconds: number): void;
