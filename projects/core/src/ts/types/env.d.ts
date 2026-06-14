// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `env` — process environment variables (PATH, etc.). Backed by the pure-JS
// singleton at /rom/lib/env.ts; shared across every `require('env')`.

interface EnvModule {
    /** Get a variable's value, or `null` if it is not set. */
    get(name: string): string | null;
    /** Set (or overwrite) a variable. */
    set(name: string, value: string): void;
    /** Remove a variable. */
    unset(name: string): void;
    /** Whether a variable is set. */
    has(name: string): boolean;
    /** A shallow copy of every variable, for listing/iteration. */
    all(): Record<string, string>;
}
