// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// ES modules → CommonJS for the engine's `require`.
//
// The interop rules, chosen so that a compiled module looks to `require` (plain JS, or code compiled elsewhere) exactly
// like a hand-written CommonJS module, and so that the TypeScript types (`esModuleInterop`, native and ROM modules
// declared as `export =`) hold at runtime:
//
// - Named exports become properties of `exports` (`export function f` → `exports.f`), so `require("util")` is the
//   object of its named exports, with nothing else on it.
// - `exports.__esModule` (which tells importers to take `exports.default` as the default export) is only set when the
//   module has a default export. Babel would set it for every module with exports; then a default import of a module
//   without a default export (`import util from "util"`, which the `export =` declarations allow) would be undefined
//   instead of the module object, as it is for Node's CommonJS modules and for the native modules.
// - `import x from "m"` is `require("m")` itself unless `m` has `__esModule` (interopRequireDefault);
//   `import { f } from "m"` reads `require("m").f` when used, so imports are live bindings and circular imports work
//   as far as the module has run; `import * as m from "m"` of a CommonJS module is an object inheriting from
//   `require("m")`, with `default` set to it (the engine's interopRequireWildcard, see ./helpers.mjs, does not copy
//   the module's members as Babel's does).
// - TypeScript's own `import x = require("m")` / `export = x` (still accepted for user projects) become
//   `const x = require("m")` / `module.exports = x` (@babel/preset-typescript).

import commonjs from "@babel/plugin-transform-modules-commonjs";

/**
 * Flag a module with a default export as an ES module (`exports.__esModule`), which the CommonJS transform does not do
 * in strict mode. Other modules stay unflagged, see above.
 *
 * @param {import("@babel/core")} babel
 */
function esModuleFlag({ types: t, template }) {
    const isDefault = (node) => t.isIdentifier(node, { name: "default" }) || t.isStringLiteral(node, { value: "default" });
    return {
        name: "rhino-es-module-flag",
        visitor: {
            // On exit, when @babel/preset-typescript has removed type-only exports (`export default interface …`), but
            // before the CommonJS transform (a later plugin) rewrites the module.
            Program: { exit(path) {
                if (path.node.sourceType !== "module") return;
                const hasDefault = path.node.body.some((statement) => t.isExportDefaultDeclaration(statement)
                    || (t.isExportNamedDeclaration(statement) && statement.exportKind !== "type"
                        && statement.specifiers.some((s) => s.exportKind !== "type" && isDefault(s.exported))));
                if (!hasDefault) return;
                path.unshiftContainer("body",
                    template.statement.ast`Object.defineProperty(exports, "__esModule", { value: true });`);
            } },
        },
    };
}

/** The plugins of the module transform, in order. */
export default [
    esModuleFlag,
    // strict: no `__esModule` flag (see esModuleFlag).
    [commonjs, { strict: true }],
];
