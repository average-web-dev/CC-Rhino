// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// End-to-end fixture for async generators and `for await` (#35): Babel compiles them to native generators driven by
// the babel-helpers wrapAsyncGenerator / awaitAsyncGenerator / asyncGeneratorDelegate / asyncIterator, which must run
// on Rhino. Run by
// JSTypeScriptAsyncTest.

interface WaitPromises {
    await(id: number): Promise<string>;
}

const probe = require("probe") as { record(value: unknown): void };
const wp = require("w/promises") as WaitPromises;

async function* inner(): AsyncGenerator<string> {
    yield await wp.await(2);
}

async function* values(): AsyncGenerator<string> {
    yield await wp.await(1);
    yield "sync";
    yield* inner();
}

async function collect(): Promise<string> {
    let out: string[] = [];
    for await (let value of values()) out.push(value);
    for await (let value of [Promise.resolve("p"), "q"]) out.push(value);
    // `f(await x)` compiles to `f(yield x)`, which Rhino only accepts parenthesized (see
    // src/build/babel-preset-rhino/parenthesize-yield.mjs).
    out.push(await Promise.resolve("r"));
    return out.join(",");
}

collect().then((v) => probe.record(v), (e) => probe.record("failed " + e));

export {};
