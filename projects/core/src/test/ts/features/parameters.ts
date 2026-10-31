// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Parameters on Rhino: all native since the Rhino fork fixed rest parameters through Function.prototype.apply (#41).
// Destructured parameters are native too, except for holes in their array patterns, which babel-preset-rhino fills
// with unused bindings (parameter-holes.mjs).

function rest(...args: unknown[]): string {
    return JSON.stringify(args);
}
check("rest parameters", rest(1, 2, 3), "[1,2,3]");
check("rest parameters via apply", rest.apply(null, [1, 2, 3]), "[1,2,3]");
check("rest parameters via call", rest.call(null, 1, 2), "[1,2]");
check("rest parameters via bind", rest.bind(null, 1)(2), "[1,2]");

function leading(first: number, ...others: number[]): string {
    return first + ":" + others.join();
}
check("rest after a parameter via apply", leading.apply(null, [1, 2, 3]), "1:2,3");

let arrow = (...xs: number[]) => xs.length;
check("arrow rest parameters via apply", arrow.apply(null, [1, 2]), 2);

function defaults(a: number, b = a + 1, { c = 3 }: { c?: number } = {}): number[] {
    return [a, b, c];
}
check("default parameters", [defaults(1), defaults(1, 5, { c: 7 })], [[1, 2, 3], [1, 5, 7]]);

function destructured({ x, y }: { x: number; y: number }, [first, second]: number[]): number {
    return x + y + first + second;
}
check("destructured parameters", destructured({ x: 1, y: 2 }, [3, 4]), 10);

function second([, b]: number[]): number {
    return b;
}
const skipTwo = ([a, , , d]: number[]) => a + d;
function nestedHole({ p: [, b] = [0, 9] }: { p?: number[] }, [[, c]]: number[][]): number {
    return b + c;
}
check("a hole in a parameter's array pattern", second([1, 2]), 2);
check("holes in an arrow parameter", skipTwo([1, 2, 3, 4]), 5);
check("nested holes, with a default", nestedHole({}, [[1, 2]]), 11);
check("length with destructured parameters", [second.length, skipTwo.length, nestedHole.length], [1, 1, 2]);

function iterableParameter([first, second]: Iterable<number>): number {
    return first + second;
}
check("array pattern parameter over an iterable", iterableParameter(new Set([1, 2])), 3);

function* generatorRest(...xs: number[]): Generator<number> {
    yield xs.length;
}
check("generator rest parameters via apply", generatorRest.apply(null, [1, 2, 3]).next().value, 3);

function usesArguments(this: unknown, ...xs: number[]): number {
    return arguments.length + xs.length;
}
check("arguments next to rest", usesArguments(1, 2), 4);

export {};
