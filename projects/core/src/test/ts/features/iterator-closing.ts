// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Iterator closing (#41): leaving a for-of early must call the iterator's return(), so a generator's `finally` runs.
// Rhino's native for-of never does; babel-preset-rhino's for-of plugin (src/build/babel-preset-rhino/for-of.mjs)
// adds it. Destructuring is closed by Babel's slicedToArray helper, `for await` by Babel's lowering
// (@babel/plugin-transform-async-generator-functions).

let log: string[] = [];

function* tracked(name: string): Generator<number> {
    try {
        yield 1;
        yield 2;
        yield 3;
    } finally {
        log.push(name);
    }
}

function closedBy(run: () => void): string[] {
    log = [];
    run();
    return log;
}

check("break closes the iterator", closedBy(() => {
    for (const x of tracked("break")) if (x === 2) break;
}), ["break"]);

check("return closes the iterator", closedBy(() => {
    (function () {
        for (const x of tracked("return")) return x;
        return 0;
    })();
}), ["return"]);

log = [];
let returned = (function (): string {
    for (const x of tracked("value")) {
        // The return value is computed before the iterator is closed.
        return log.length + ":" + x;
    }
    return "none";
})();
check("return value computed before closing", [returned, log], ["0:1", ["value"]]);

check("throw closes the iterator and keeps the exception", closedBy(() => {
    try {
        for (const x of tracked("throw")) throw new Error("boom " + x);
    } catch (e) {
        log.push((e as Error).message);
    }
}), ["throw", "boom 1"]);

check("labelled break and continue out of nested loops close inner, then outer", closedBy(() => {
    outer: for (const a of tracked("outer")) {
        for (const b of tracked("inner")) {
            if (a === 1) continue outer;
            if (b === 1) break outer;
        }
    }
}), ["inner", "inner", "outer"]);

check("return out of nested loops closes inner, then outer", closedBy(() => {
    (function () {
        for (const a of tracked("outer")) for (const b of tracked("inner")) return a + b;
        return 0;
    })();
}), ["inner", "outer"]);

check("running to the end, continue and an inner switch do not close early", closedBy(() => {
    for (const x of tracked("end")) {
        switch (x) {
            case 1:
                break;
            default:
                continue;
        }
        log.push("body");
    }
}), ["body", "end"]);

check("break inside a closure-capturing loop body", closedBy(() => {
    let fns: (() => number)[] = [];
    for (const x of tracked("captured")) {
        fns.push(() => x);
        if (x === 2) break;
    }
    log.push(fns.map((f) => f()).join());
}), ["captured", "1,2"]);

check("closing a generator suspended in a for-of closes the inner iterator", closedBy(() => {
    function* outer(): Generator<number> {
        for (const x of tracked("delegated")) yield x;
    }
    let it = outer();
    it.next();
    it.return(undefined);
}), ["delegated"]);

function plainIterable(): { iterable: Iterable<number>; closes: () => number } {
    let closes = 0;
    let i = 0;
    // An iterator that is not iterable itself, as in a hand-written [Symbol.iterator]().
    let iterator = {
        next: (): IteratorResult<number> => i < 5 ? { value: ++i, done: false } : { value: undefined, done: true },
        return: (): IteratorResult<number> => {
            closes++;
            return { value: undefined, done: true };
        },
    };
    return { iterable: { [Symbol.iterator]: () => iterator }, closes: () => closes };
}

let plain = plainIterable();
let seen: number[] = [];
for (const x of plain.iterable) {
    seen.push(x);
    if (x === 2) break;
}
check("plain iterator: closed once on break", [seen, plain.closes()], [[1, 2], 1]);

let exhausted = plainIterable();
for (const x of exhausted.iterable) seen.push(x);
check("plain iterator: not closed when done", exhausted.closes(), 0);

function throwingReturn(): Iterable<number> {
    let iterator = {
        next: (): IteratorResult<number> => ({ value: 1, done: false }),
        return: (): IteratorResult<number> => {
            throw new Error("from return");
        },
    };
    return { [Symbol.iterator]: () => iterator };
}

let errors: string[] = [];
try {
    for (const x of throwingReturn()) throw new Error("from body " + x);
} catch (e) {
    errors.push((e as Error).message);
}
try {
    for (const x of throwingReturn()) if (x) break;
} catch (e) {
    errors.push((e as Error).message);
}
check("an error from return(): lost to the body's exception, raised on break", errors, ["from body 1", "from return"]);

let arrays: number[] = [];
for (const x of [1, 2, 3]) {
    if (x === 3) break;
    arrays.push(x);
}
let list = [4, 5, 6];
for (const x of list) {
    if (x === 6) break;
    arrays.push(x);
}
check("arrays", arrays, [1, 2, 4, 5]);

check("array destructuring closes the iterator", closedBy(() => {
    let [first] = tracked("destructured");
    log.push(String(first));
}), ["destructured", "1"]);

check("array destructuring with a rest element exhausts the iterator", closedBy(() => {
    let [, ...rest] = tracked("rest");
    log.push(rest.join());
}), ["rest", "2,3"]);

async function asyncChecks(): Promise<void> {
    log = [];
    for await (const x of tracked("for await, sync source")) if (x === 1) break;

    async function* asyncTracked(): AsyncGenerator<number> {
        try {
            yield 1;
            yield 2;
        } finally {
            log.push("for await, async generator");
        }
    }
    for await (const x of asyncTracked()) if (x === 1) break;
    try {
        for await (const x of asyncTracked()) throw new Error("async boom " + x);
    } catch (e) {
        log.push((e as Error).message);
    }
    check("for await closes the iterator", log,
        ["for await, sync source", "for await, async generator", "for await, async generator", "async boom 1"]);
}
asyncChecks().catch((e) => check("for await closes the iterator", "failed: " + e, ""));

export {};
