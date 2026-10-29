// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Destructuring on Rhino: array patterns ignore the iterator protocol and rest elements are a syntax error
// (transform-destructuring); object rest is lowered by tsc.

let [a, b] = new Set([1, 2]);
check("array pattern over an iterable", a + b, 3);

let [head, ...tail] = [1, 2, 3];
check("rest element", [head, tail], [1, [2, 3]]);

let [, second, , fourth = 4] = [1, 2, 3];
check("holes and defaults", [second, fourth], [2, 4]);

function* letters(): Generator<string> {
    yield "x";
    yield "y";
    yield "z";
}
let [first, ...others] = letters();
check("pattern over a generator", [first, others.join("")], ["x", "yz"]);

let x = 1, y = 2;
[x, y] = [y, x];
check("swap", [x, y], [2, 1]);

let { p, q: { r = 5 } = {}, ...remaining } = { p: 1, q: {}, s: 3, t: 4 } as { p: number; q?: { r?: number }; s: number; t: number };
check("nested object pattern with rest", [p, r, Object.keys(remaining).join()], [1, 5, "s,t"]);

let key = "dynamic";
let { [key]: computed } = { dynamic: "value" } as Record<string, string>;
check("computed key", computed, "value");

let pairs: string[] = [];
for (const [k, v] of new Map([["one", 1], ["two", 2]])) pairs.push(k + v);
check("for-of with an array pattern", pairs, ["one1", "two2"]);

export {};
