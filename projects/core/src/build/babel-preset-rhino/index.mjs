// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// babel-preset-rhino: exactly the transforms Mozilla Rhino 1.9.1 (interpreter mode, VERSION_ES6) needs to run modern
// JavaScript. Rhino's support was determined empirically; the feature matrix test
// (projects/core/src/test/java/dan200/computercraft/core/engine/JSRhinoFeatureTest.java) pins it, so a Rhino upgrade
// that fixes one of these tells us which plugin can go.
//
// Natively supported (not transformed): arrow functions, template literals (also tagged), let/const outside loops,
// default parameters, simple destructuring, object spread, array spread, optional chaining, `??`, `**`, logical
// assignment, numeric separators, computed/shorthand properties and methods, for-of over iterables, Symbol,
// generators, optional catch binding, BigInt.
//
// Transformed, because Rhino lacks or breaks them:
// - class syntax (all of it: Rhino reserves the `class` keyword), class fields, #private, static blocks
// - `const` inside loops (keeps the value of the first iteration), `const` in for-of heads (syntax error), and `let`
//   in loop heads captured by closures (one binding for all iterations)
// - spread in calls and `new` (syntax error)
// - rest parameters (wrong when the function is called through Function.prototype.apply: [thisArg, argsArray])
// - array destructuring (ignores the iterator protocol, rest elements are a syntax error), object rest
// - `new.target` (syntax error)
// - unparenthesized `yield` in argument lists, and its operand being parsed as a comma expression (own plugin)
//
// Worked around in the helpers module instead (see RHINO_OVERRIDES in ./helpers.mjs): Reflect.get ignores its receiver
// (`super.getter`), and reading `stack` of an Error whose prototype was changed throws a Java ClassCastException
// (`class E extends Error`).
//
// Known gap, deliberately not transformed: leaving a for-of early (break, return, throw) does not call the iterator's
// return(), so a generator's `finally` does not run. transform-for-of would wrap every for-of in try/finally.
//
// Not handled here: async functions and async generators. Rhino lacks them, but the CC: Rhino pipeline lets tsc lower
// them (target es2015 + importHelpers → `__awaiter` & co. from the engine's native `tslib`), which keeps generators
// native (Rhino's continuations rely on that; regenerator is never used).
//
// Runtime helpers are not inlined: each file imports them from the engine's native `babel-helpers` module (see
// ./external-helpers.mjs and ./helpers.mjs), the same way tsc's output imports `tslib`.

import classStaticBlock from "@babel/plugin-transform-class-static-block";
import privatePropertyInObject from "@babel/plugin-transform-private-property-in-object";
import classProperties from "@babel/plugin-transform-class-properties";
import privateMethods from "@babel/plugin-transform-private-methods";
import objectRestSpread from "@babel/plugin-transform-object-rest-spread";
import parameters from "@babel/plugin-transform-parameters";
import classes from "@babel/plugin-transform-classes";
import spread from "@babel/plugin-transform-spread";
import destructuring from "@babel/plugin-transform-destructuring";
import blockScoping from "@babel/plugin-transform-block-scoping";
import newTarget from "@babel/plugin-transform-new-target";

import externalHelpers from "./external-helpers.mjs";
import parenthesizeYield from "./parenthesize-yield.mjs";
import { HELPERS_MODULE } from "./helpers.mjs";

/**
 * @param {import("@babel/core").ConfigAPI} api
 * @param {{ helpersModule?: string | false }} [options] `helpersModule`: the module the helpers are imported from
 *     (default `babel-helpers`); `false` inlines them into each file instead (used to build that module itself).
 */
export default function babelPresetRhino(api, options = {}) {
    const { helpersModule = HELPERS_MODULE } = options;
    return {
        plugins: [
            // The order follows @babel/preset-env (newest syntax first).
            classStaticBlock,
            privatePropertyInObject,
            classProperties,
            privateMethods,
            // Only object *rest* is needed (Rhino has object spread), but the plugin handles both. useBuiltIns:
            // Object.assign instead of a helper.
            [objectRestSpread, { useBuiltIns: true }],
            parameters,
            classes,
            spread,
            destructuring,
            blockScoping,
            newTarget,
            parenthesizeYield,
            ...(helpersModule === false ? [] : [[externalHelpers, { moduleName: helpersModule }]]),
        ],
    };
}
