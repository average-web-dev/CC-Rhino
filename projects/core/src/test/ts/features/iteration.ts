// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Iteration (native on Rhino): for-of over arrays, strings, Sets, Maps and custom iterables, Symbol.

let total = 0;
for (const n of [1, 2, 3]) total += n;
check("for-of over an array", total, 6);

let chars: string[] = [];
for (const ch of "abc") chars.push(ch);
check("for-of over a string", chars, ["a", "b", "c"]);

let entries: string[] = [];
for (const [k, v] of new Map([["a", 1]])) entries.push(k + v);
for (const v of new Set(["s"])) entries.push(v);
check("for-of over Map and Set", entries, ["a1", "s"]);

let range = {
    from: 1,
    to: 3,
    [Symbol.iterator](): Iterator<number> {
        let current = this.from;
        let last = this.to;
        return {
            next: () => current <= last ? { value: current++, done: false } : { value: undefined, done: true },
        };
    },
};
check("custom iterable", Array.from(range), [1, 2, 3]);
check("spread of a custom iterable", [...range], [1, 2, 3]);

// Leaving a for-of early (closing the iterator) is checked in iterator-closing.ts.

let symbol = Symbol("description");
check("Symbol", [typeof symbol, symbol.toString()], ["symbol", "Symbol(description)"]);

export {};
