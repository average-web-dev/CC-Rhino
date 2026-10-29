// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

import { HELPERS, HELPERS_MODULE } from "./helpers.mjs";

/**
 * Import Babel's runtime helpers from one module instead of inlining them into every file, like tsc's
 * `importHelpers` does with `tslib`. The declaration is the file's first statement (see `post`), above the
 * `require`s of the CommonJS transform, which use helpers too. A file using `_classCallCheck` & co. gets one
 * `var _babelHelpers = require("babel-helpers");` and calls `_babelHelpers.classCallCheck(…)`.
 *
 * Files parsed with `sourceType: "script"` (e.g. the bios, which runs in the global scope) must not declare a
 * top-level variable, so there every use is `require("babel-helpers").name` instead.
 *
 * Helpers that the module does not provide (see HELPERS in ./helpers.mjs) fail the build, rather than failing at
 * runtime.
 *
 * @param {import("@babel/core")} babel
 * @param {{ moduleName?: string }} options
 */
export default function externalHelpers({ types: t }, { moduleName = HELPERS_MODULE } = {}) {
    const requireHelpers = () => t.callExpression(t.identifier("require"), [t.stringLiteral(moduleName)]);
    /** The path of the `var _babelHelpers = require(…)` declaration of the current file. */
    let declaration;

    return {
        name: "rhino-external-helpers",
        pre(file) {
            const script = file.opts.sourceType === "script";
            let namespace;
            declaration = undefined;
            file.set("helperGenerator", (name) => {
                if (!HELPERS.has(name)) {
                    throw new Error(
                        `Babel helper "${name}" is not provided by the "${moduleName}" module. ` +
                        "Add it to HELPERS in babel-preset-rhino/helpers.mjs (after checking that it runs on Rhino).",
                    );
                }
                if (script) return t.memberExpression(requireHelpers(), t.identifier(name));

                if (!namespace) {
                    namespace = file.scope.generateUidIdentifier("babelHelpers");
                    [declaration] = file.path.unshiftContainer("body", t.variableDeclaration("var", [
                        t.variableDeclarator(namespace, requireHelpers()),
                    ]));
                    file.scope.registerDeclaration(declaration);
                }
                return t.memberExpression(t.cloneNode(namespace), t.identifier(name));
            });
        },
        post(file) {
            // Other plugins insert statements above it later (the CommonJS transform's `require`s, which already use
            // helpers such as interopRequireDefault): move the declaration back to the top.
            if (!declaration) return;
            const body = file.path.node.body;
            const index = body.indexOf(declaration.node);
            if (index > 0) {
                body.splice(index, 1);
                body.unshift(declaration.node);
            }
        },
    };
}
