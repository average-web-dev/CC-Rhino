// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The Babel runtime helpers the engine ships as its native `babel-helpers` module (JSBabelHelpers), and the code of
// that module, generated from @babel/helpers at build time so that it always matches the Babel version that compiled
// the code using it.

import { buildExternalHelpers, transformSync } from "@babel/core";
import { getDependencies, list as babelHelpers } from "@babel/helpers";
import { fileURLToPath } from "node:url";

/** The module compiled code imports the helpers from. */
export const HELPERS_MODULE = "babel-helpers";

/**
 * The helpers the preset's plugins use (plus their dependencies, added below). Decorators, regenerator & co. are
 * deliberately missing: the preset does not include those transforms.
 */
const USED_HELPERS = [
    // classes
    "classCallCheck", "createClass", "inherits", "callSuper", "possibleConstructorReturn", "assertThisInitialized",
    "getPrototypeOf", "setPrototypeOf", "wrapNativeSuper", "construct", "superPropGet", "superPropSet", "get", "set",
    "superPropBase", "classNameTDZError", "defineProperty", "toPropertyKey", "toPrimitive", "typeof",
    // class fields, #private, static blocks, `#x in obj`
    "defineAccessor", "setFunctionName", "assertClassBrand", "classPrivateFieldGet2", "classPrivateFieldSet2",
    "classPrivateFieldInitSpec", "classPrivateMethodInitSpec", "classPrivateGetter", "classPrivateSetter",
    "checkPrivateRedeclaration", "checkInRHS", "toSetter", "identity", "readOnlyError", "writeOnlyError",
    // spread, destructuring (incl. object rest), parameters
    "toConsumableArray", "slicedToArray", "toArray", "maybeArrayLike", "objectDestructuringEmpty",
    "objectWithoutProperties", "objectWithoutPropertiesLoose", "extends",
    // block scoping
    "tdz", "temporalRef", "temporalUndefined",
    // async functions, async generators, for await
    "asyncToGenerator", "wrapAsyncGenerator", "awaitAsyncGenerator", "asyncGeneratorDelegate", "asyncIterator",
    "OverloadYield",
    // ES modules → CommonJS
    "interopRequireDefault", "interopRequireWildcard",
];

function withDependencies(names) {
    const all = new Set();
    const add = (name) => {
        if (all.has(name)) return;
        if (!babelHelpers.includes(name)) throw new Error(`Unknown Babel helper ${name}`);
        all.add(name);
        for (const dependency of getDependencies(name)) add(dependency);
    };
    names.forEach(add);
    return all;
}

/** Every helper the `babel-helpers` module provides. */
export const HELPERS = withDependencies(USED_HELPERS);

/**
 * Fixes for Rhino, applied after Babel's own definitions. `babelHelpers` is the module object; helpers call each other
 * through it, so replacing a member replaces it everywhere.
 */
const RHINO_OVERRIDES = `
// The namespace of a CommonJS module (a native module, a ROM module, anything without __esModule) for
// \`import * as m from "m"\` (and for \`import m, { a } from "m"\`, which Babel compiles to \`ns.default\` / \`ns.a\`): an
// object whose prototype is the module object, with \`default\` (the module object) as its only own member. Babel's
// helper copies the module's own enumerable properties instead, so later changes to the module (a circular import
// that has not finished yet) are lost and non-enumerable members are missing; here every member is read from the
// module when it is used. One namespace per module, as with Babel's helper.
var namespaces = new WeakMap();
babelHelpers.interopRequireWildcard = function (obj) {
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return { default: obj };
  if (obj.__esModule) return obj;
  var namespace = namespaces.get(obj);
  if (namespace === undefined) {
    namespace = Object.create(obj, { default: { value: obj, enumerable: true } });
    namespaces.set(obj, namespace);
  }
  return namespace;
};
`;

/**
 * The source of the `babel-helpers` module: a script whose completion value is the helpers object. It declares no
 * globals.
 */
export function buildHelpersModule() {
    const helpers = buildExternalHelpers([...HELPERS].sort(), "var").replace(/\nbabelHelpers;\s*$/, "\n");
    if (helpers.includes("\nbabelHelpers;")) throw new Error("Unexpected buildExternalHelpers output");

    const source = `(function () {\n"use strict";\n${helpers}\n${RHINO_OVERRIDES}\nreturn babelHelpers;\n})();\n`;

    // The helpers are written in (mostly) ES5, but run them through the preset's transforms anyway, without helper
    // imports: requesting a helper here fails the build.
    const result = transformSync(source, {
        babelrc: false,
        configFile: false,
        sourceType: "script",
        compact: false,
        comments: true,
        presets: [[fileURLToPath(new URL("./index.mjs", import.meta.url)), { helpersModule: false }]],
        plugins: [
            () => ({
                pre(file) {
                    file.set("helperGenerator", (name) => {
                        throw new Error(`The babel-helpers module itself needs the helper ${name}`);
                    });
                },
            }),
        ],
    });
    return result.code;
}
