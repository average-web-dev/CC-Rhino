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
    // spread, destructuring, parameters, object rest
    "toConsumableArray", "slicedToArray", "toArray", "maybeArrayLike", "objectDestructuringEmpty",
    "objectWithoutProperties", "objectWithoutPropertiesLoose", "extends", "objectSpread2",
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

/** Helpers of babel-preset-rhino's own plugins, defined in RHINO_HELPERS below. */
const RHINO_HELPER_NAMES = ["rhinoForOf", "rhinoForOfClose", "rhinoForOfAbort"];

/** The Babel helpers the `babel-helpers` module provides. */
const BABEL_HELPERS = withDependencies(USED_HELPERS);

/** Every helper the `babel-helpers` module provides. */
export const HELPERS = new Set([...BABEL_HELPERS, ...RHINO_HELPER_NAMES]);

/**
 * Fixes for Rhino, applied after Babel's own definitions. `babelHelpers` is the module object; helpers call each other
 * through it, so replacing a member replaces it everywhere.
 */
const RHINO_OVERRIDES = `
// Rhino computes an Error's \`stack\` lazily and casts its prototype to a native Error when it does (a Java
// ClassCastException otherwise). Babel's wrapNativeSuper creates subclass instances (\`class E extends Error\`) as a
// plain native object whose prototype is then changed, so compute the stack first.
var construct = babelHelpers.construct;
babelHelpers.construct = function (Parent, args, Class) {
  var instance = construct(Parent, args);
  if (instance instanceof Error) void instance.stack;
  if (Class) babelHelpers.setPrototypeOf(instance, Class.prototype);
  return instance;
};

// Rhino's Reflect.get ignores the receiver, so a getter read through \`super.x\` would see the prototype as \`this\`.
// Use Babel's own fallback for environments without Reflect.
babelHelpers.get = function (target, property, receiver) {
  var base = babelHelpers.superPropBase(target, property);
  if (!base) return undefined;
  var descriptor = Object.getOwnPropertyDescriptor(base, property);
  return descriptor.get ? descriptor.get.call(arguments.length < 3 ? target : receiver) : descriptor.value;
};

// Rhino's generator functions do not inherit from Function.prototype, but asyncToGenerator and wrapAsyncGenerator call
// \`fn.apply(this, arguments)\` on the generator function they get: hand them a plain function that borrows apply.
var apply = Function.prototype.apply;
function applyGenerator(wrap) {
  return function (fn) {
    return wrap(function () { return apply.call(fn, this, arguments); });
  };
}
babelHelpers.asyncToGenerator = applyGenerator(babelHelpers.asyncToGenerator);
babelHelpers.wrapAsyncGenerator = applyGenerator(babelHelpers.wrapAsyncGenerator);

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
 * The helpers of babel-preset-rhino's own plugins (see RHINO_HELPER_NAMES).
 */
const RHINO_HELPERS = `
// for-of that closes its iterator when the loop is left early (./for-of.mjs). rhinoForOf returns what the native loop
// iterates: a plain array as it is (its iterator has nothing to close), otherwise the iterator itself.
var arrayValues = [][Symbol.iterator];
function IteratorWrapper(iterator) {
  var next = iterator.next;
  this.iterator = iterator;
  this.next = function () { return next.call(iterator); };
}
IteratorWrapper.prototype[Symbol.iterator] = function () { return this; };
babelHelpers.rhinoForOf = function (o) {
  if (Array.isArray(o) && o[Symbol.iterator] === arrayValues) return o;
  var method = o == null ? undefined : o[Symbol.iterator];
  if (typeof method !== "function") {
    throw new TypeError((typeof o === "symbol" ? o.toString() : String(o)) + " is not iterable");
  }
  var iterator = method.call(o);
  if (Object(iterator) !== iterator) throw new TypeError("Result of the Symbol.iterator method is not an object");
  // Rhino's for-of asks the iterator for its iterator again: wrap one that is not iterable itself.
  return typeof iterator[Symbol.iterator] === "function" ? iterator : new IteratorWrapper(iterator);
};
// The loop was left by break, continue or return: errors of return() propagate.
babelHelpers.rhinoForOfClose = function (iterator) {
  if (Array.isArray(iterator)) return;
  if (iterator instanceof IteratorWrapper) iterator = iterator.iterator;
  var method = iterator["return"];
  if (method == null) return;
  var result = method.call(iterator);
  if (Object(result) !== result) throw new TypeError("Iterator result " + result + " is not an object");
};
// The loop was left by an exception: that exception wins over errors of return().
babelHelpers.rhinoForOfAbort = function (iterator) {
  try {
    babelHelpers.rhinoForOfClose(iterator);
  } catch (e) {
    // Ignored, as the spec says.
  }
};
`;

/**
 * The source of the `babel-helpers` module: a script whose completion value is the helpers object. It declares no
 * globals.
 */
export function buildHelpersModule() {
    const helpers = buildExternalHelpers([...BABEL_HELPERS].sort(), "var").replace(/\nbabelHelpers;\s*$/, "\n");
    if (helpers.includes("\nbabelHelpers;")) throw new Error("Unexpected buildExternalHelpers output");

    const source = `(function () {\n"use strict";\n${helpers}\n${RHINO_OVERRIDES}\n${RHINO_HELPERS}\nreturn babelHelpers;\n})();\n`;

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
