// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `tslib` — the helpers tsc's `importHelpers` output calls (`require("tslib").__awaiter(...)`), provided natively by
// the engine (JSPromises). `async` functions compile to a generator driven by `__awaiter`.
//
// Only the helpers the engine implements are declared: code needing any other helper (e.g. async generators, which
// need `__asyncGenerator`) fails to compile with "requires an imported helper … which does not exist in 'tslib'"
// instead of failing at runtime.

declare module "tslib" {
    export function __awaiter(thisArg: any, _arguments: any, P: Function | undefined, generator: Function): any;
    export function __assign(t: any, ...sources: any[]): any;
    export function __rest(t: any, propertyNames: (string | symbol)[]): any;
}
