// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Spread on Rhino: a syntax error in calls and `new` (transform-spread); array and object spread are native.

function sum(...numbers: number[]): number {
    let total = 0;
    for (const n of numbers) total += n;
    return total;
}

let numbers = [1, 2, 3];
check("spread in calls", sum(...numbers), 6);
check("spread with other arguments", sum(10, ...numbers, 20), 36);
check("spread of an iterable", sum(...new Set([4, 5])), 9);
check("spread into a method call", Math.max(...numbers), 3);

let receiver = {
    base: 100,
    add(...xs: number[]) {
        return this.base + sum(...xs);
    },
};
check("spread keeps this", receiver.add(...numbers), 106);

class Point {
    constructor(public x: number, public y: number) {}
}
let coords: [number, number] = [3, 4];
let point = new Point(...coords);
check("spread in new", [point.x, point.y], [3, 4]);
check("spread in new Date", new Date(...([2020, 0, 2] as const)).getDate(), 2);

check("array spread", [0, ...numbers, ...new Set([4]), ..."ab"], [0, 1, 2, 3, 4, "a", "b"]);
let merged = { ...{ a: 1, b: 2 }, b: 3 };
check("object spread", [merged.a, merged.b], [1, 3]);

export {};
