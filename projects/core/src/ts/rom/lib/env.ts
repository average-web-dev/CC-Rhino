// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/env.ts — process environment variables (PATH, etc.).
//
// A pure-JS singleton: `require` caches modules by path, so every `require('env')`
// hands back this same table. State lives entirely on the JS side — nothing is
// stored in Java. The shell expands `$VAR` from here; programs can get/set too.
//
// PATH is special: it is a *live alias* of `require.paths` (the module search
// path). There is no separate copy, so the two can never drift — setting PATH
// updates module resolution immediately, and reading it reflects require.paths.

const vars: Record<string, string> = {};

function owns(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(vars, name);
}

/** Split a `:`-separated PATH into a clean list (dropping empty segments). */
function splitPath(value: string): string[] {
    return value.split(':').filter(seg => seg.length > 0);
}

/** Get a variable's value, or `null` if it is not set. */
export function get(name: string): string | null {
    if (name === 'PATH') return require.paths.join(':');
    return owns(name) ? vars[name]! : null;
}

/** Set (or overwrite) a variable. */
export function set(name: string, value: string): void {
    if (name === 'PATH') { require.paths = splitPath(value); return; }
    vars[name] = value;
}

/** Remove a variable. */
export function unset(name: string): void {
    if (name === 'PATH') { require.paths = []; return; }
    delete vars[name];
}

/** Whether a variable is set. */
export function has(name: string): boolean {
    return name === 'PATH' || owns(name);
}

/** A shallow copy of every variable, for listing/iteration. */
export function all(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let key of Object.keys(vars)) out[key] = vars[key]!;
    out['PATH'] = require.paths.join(':');
    return out;
}

// The exports implement the module's public type (types/env.d.ts).
type Exports<T extends EnvModule> = T;
type _Exports = Exports<typeof import('/rom/lib/env')>;
