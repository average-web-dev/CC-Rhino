// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// End-to-end fixture for the async pipeline (#35): tsc compiles these `async` functions to generators driven by
// require("tslib").__awaiter (importHelpers), which must run on Rhino. Run by JSTypeScriptAsyncTest, which provides
// the `w` and `probe` modules. Follows the ROM's Rhino authoring constraints (no `const` in loops, no spread).

interface WaitPromises {
    await(id: number): Promise<string>;
}

const probe = require("probe") as { record(value: unknown): void };
const wp = require("w/promises") as WaitPromises;

async function collect(id: number): Promise<string> {
    let total = await wp.await(id);
    for (let i = 1; i <= 2; i++) {
        let part = await wp.await(id + i);
        total += part;
    }
    try {
        await wp.await(99);
    } catch (e) {
        total += " caught " + (e as Error).message;
    }
    return total;
}

const twice = async (id: number) => (await collect(id)) + "!";

twice(1).then((v) => probe.record(v), (e) => probe.record("failed " + e));

export {};
