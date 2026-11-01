// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/env.ts — process environment variables (PATH, etc.).
//
// A pure-JS singleton: `require` caches modules by path, so every `require('env')`
// hands back this same table. State lives entirely on the JS side — nothing is
// stored in Java. The shell expands `$VAR` from here; programs can get/set too.
//
// PATH is an ordinary variable: the directories bash and child_process search for programs (the OS sets
// /rom/os/bin:/rom/bin). Modules are searched on require.paths instead (like Node's NODE_PATH), so a program and a
// module may share a name (the `redstone` program, the native `redstone` module).

const vars: Record<string, string> = {};

function owns(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(vars, name);
}

/** Get a variable's value, or `null` if it is not set. */
export function get(name: string): string | null {
    return owns(name) ? vars[name]! : null;
}

/** Set (or overwrite) a variable. */
export function set(name: string, value: string): void {
    vars[name] = value;
}

/** Remove a variable. */
export function unset(name: string): void {
    delete vars[name];
}

/** Whether a variable is set. */
export function has(name: string): boolean {
    return owns(name);
}

/** A shallow copy of every variable, for listing/iteration. */
export function all(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let key of Object.keys(vars)) out[key] = vars[key]!;
    return out;
}

// The exports implement the module's public type (types/env.d.ts).
type Exports<T extends EnvModule> = T;
type _Exports = Exports<typeof import('/rom/lib/env')>;
