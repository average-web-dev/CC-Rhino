// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `async` — bridges blocking and promise-based code. Native module implemented by the engine (JSPromises).
//
// Every native module `x` has a promise flavour `require("x/promises")` with the same functions, each returning a
// Promise instead of blocking (Node-style `fooSync` + callback `foo` pairs become one promise-returning `foo`, as in
// Node's fs/promises). Blocking functions cannot be called inside async code (TypeScript `async` functions, generator
// functions, promise callbacks): they throw an Error pointing to the `/promises` module instead.

interface AsyncModule {
    /**
     * Run a generator function as an async function — the plain-JS form of a TypeScript `async` function (it uses
     * the same helper as tsc's output). Each `yield`ed promise is awaited: `yield` evaluates to its value, or throws
     * its rejection reason. Other yielded values are passed back unchanged. Resolves with the generator's return
     * value, or rejects with the error it throws.
     *
     * ```js
     * async.run(function* () {
     *     var ok = yield require('turtle/promises').dig();
     *     return ok.success;
     * });
     * ```
     */
    run<T, A extends unknown[]>(fn: (...args: A) => Generator<unknown, T, any>, ...args: A): Promise<T>;
    /**
     * Block the calling thread until `value` settles, then return its value, or throw its rejection reason. Values
     * that are not promises (or thenables) are returned unchanged. Other threads, listeners and promise callbacks keep
     * running meanwhile. Like every blocking call, it cannot be used inside async code — use `await` / `yield` there.
     */
    unwrap<T>(value: T | PromiseLike<T>): T;
}
