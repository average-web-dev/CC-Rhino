// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `tslib` — the helpers tsc's `importHelpers` output calls (`require("tslib").__awaiter(...)`), provided natively by
// the engine (JSPromises) for TypeScript compiled by tsc elsewhere. (CC: Rhino's own pipeline, compile-ts.mjs, compiles
// with Babel and uses the engine's `babel-helpers` module instead.) `async` functions compile to a generator driven by
// `__awaiter`.
//
// Async generators (`async function*`, `yield*` in them) and `for await` use `__asyncGenerator`, `__await`,
// `__asyncDelegator` and `__asyncValues`; the engine polyfills `Symbol.asyncIterator`, which Rhino lacks.
//
// `#private` class members use `__classPrivateFieldGet`/`Set`/`In` (with WeakMaps/WeakSets); the classes themselves
// are lowered afterwards by Babel (babel-preset-rhino, helpers from the native `babel-helpers` module).
//
// Only the helpers the engine implements are declared: code needing any other helper (e.g. decorators) fails to
// compile with "requires an imported helper … which does not exist in 'tslib'" instead of failing at runtime.

declare module "tslib" {
    export function __awaiter(thisArg: any, _arguments: any, P: Function | undefined, generator: Function): any;
    export function __assign(t: any, ...sources: any[]): any;
    export function __rest(t: any, propertyNames: (string | symbol)[]): any;
    export function __await(v: any): any;
    export function __asyncGenerator(thisArg: any, _arguments: any, generator: Function): any;
    export function __asyncDelegator(o: any): any;
    export function __asyncValues(o: any): any;
    export function __classPrivateFieldGet(receiver: any, state: any, kind?: string, f?: Function): any;
    export function __classPrivateFieldSet(receiver: any, state: any, value: any, kind?: string, f?: Function): any;
    export function __classPrivateFieldIn(state: any, receiver: unknown): boolean;
}
