// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Block scoping on Rhino: `const` in loops keeps its first value, `const` in for-of heads is a syntax error, and `let`
// in loop heads shares one binding between iterations (transform-block-scoping).

let values: number[] = [];
for (let i = 0; i < 3; i++) {
    const doubled = i * 2;
    values.push(doubled);
}
check("const in a loop body", values, [0, 2, 4]);

values = [];
for (const value of [1, 2, 3]) values.push(value);
check("const in a for-of head", values, [1, 2, 3]);

let closures: (() => number)[] = [];
for (let i = 0; i < 3; i++) closures.push(() => i);
check("let in a for head, captured", closures.map((f) => f()), [0, 1, 2]);

closures = [];
for (const value of [5, 6, 7]) closures.push(() => value);
check("const in a for-of head, captured", closures.map((f) => f()), [5, 6, 7]);

closures = [];
let n = 0;
while (n < 3) {
    const captured = n++;
    closures.push(() => captured);
}
check("const in a while body, captured", closures.map((f) => f()), [0, 1, 2]);

// Control flow out of loop bodies that become closures.
function find(items: string[], wanted: string): number {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        closures.push(() => i);
        if (item === wanted) return i;
    }
    return -1;
}
check("return from a closure-converted loop", find(["a", "b", "c"], "b"), 1);

let visited: string[] = [];
outer: for (const a of ["x", "y"]) {
    for (const b of [1, 2, 3]) {
        closures.push(() => b);
        if (b === 2) continue outer;
        if (a === "y") break outer;
        visited.push(a + b);
    }
}
check("labelled break and continue", visited, ["x1"]);

// Generators with captured loop variables (the loop body becomes a nested generator).
function* gen(): Generator<() => number> {
    for (let i = 0; i < 2; i++) yield () => i;
}
check("let captured in a generator loop", Array.from(gen()).map((f) => f()), [0, 1]);

{
    const shadowed = "inner";
    check("block-scoped const", shadowed, "inner");
}
const shadowed = "outer";
check("shadowing", shadowed, "outer");

export {};
