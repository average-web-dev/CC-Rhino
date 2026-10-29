// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Newer operators (native on Rhino, so Babel leaves them alone): optional chaining, nullish coalescing,
// exponent, logical assignment, numeric separators.

type Node = { value: number; next?: Node; fn?: () => number };
let list: Node = { value: 1, next: { value: 2, fn: () => 42 } };
let missing: Node | undefined;

check("optional chaining", [list.next?.value, list.next?.next?.value, missing?.value], [2, undefined, undefined]);
check("optional calls", [list.next?.fn?.(), list.fn?.()], [42, undefined]);
check("optional element access", [list?.["value"], missing?.["value"]], [1, undefined]);

let zero = 0;
let nothing: number | null = null;
check("nullish coalescing", [zero ?? 5, nothing ?? 5], [0, 5]);

let power = 3;
power **= 2;
check("exponent", [2 ** 10, power, (-2) ** 3], [1024, 9, -8]);

let a: number | null = null, b = 1, c = 0;
a ??= 4;
b &&= 5;
c ||= 6;
check("logical assignment", [a, b, c], [4, 5, 6]);

check("numeric separators", 1_000_000 + 0x00_ff, 1000255);

export {};
