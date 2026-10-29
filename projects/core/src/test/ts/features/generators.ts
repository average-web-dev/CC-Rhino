// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Generators stay native generators (Rhino's continuations depend on it); `yield` is parenthesized for Rhino's parser.
// Async functions and async generators are lowered to generators too (see async.ts and async-generators.ts).

function* counter(limit: number): Generator<number, string, number | undefined> {
    let received: number[] = [];
    for (let i = 0; i < limit; i++) {
        // An unparenthesized `yield` in an argument list is a syntax error on Rhino.
        received.push(Number(yield i));
    }
    return received.join();
}

let it = counter(3);
let yielded = [it.next().value, it.next(10).value, it.next(20).value];
check("yield in arguments", [yielded, it.next(30).value], [[0, 1, 2], "10,20,30"]);

function* comma(): Generator<number, number, number> {
    let x = 0, r: number;
    r = yield x, x = 5;
    return r + x;
}
let c = comma();
check("yield operand before a comma", [c.next().value, c.next(1).value], [0, 6]);

function* inner(): Generator<string, string> {
    yield "a";
    return "inner done";
}
function* outer(): Generator<string> {
    let result = yield* inner();
    yield result;
}
check("yield*", Array.from(outer()), ["a", "inner done"]);

check("generator methods", Array.from({ *items() { yield 1; yield 2; } }.items()), [1, 2]);

let cleanup = "";
function* withFinally(): Generator<number> {
    try {
        yield 1;
        yield 2;
    } finally {
        cleanup = "ran";
    }
}
let gen = withFinally();
gen.next();
check("return() runs finally", [gen.return(9).value, cleanup], [9, "ran"]);

export {};
