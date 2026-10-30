// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// babel-preset-rhino: exactly the transforms Mozilla Rhino needs to run modern JavaScript: Rhino 1.9.x with the
// backports of average-web-dev/rhino (branch rhino_1_9_backports), interpreter mode, VERSION_ECMASCRIPT. Rhino's
// support was determined empirically; the feature matrix test
// (projects/core/src/test/java/dan200/computercraft/core/engine/JSRhinoFeatureTest.java) pins it, so a Rhino upgrade
// that fixes one of these tells us which plugin can go.
//
// The preset takes ES modules (and plain CommonJS scripts) and emits CommonJS for the engine's `require`; TypeScript
// syntax is stripped beforehand by @babel/preset-typescript (see ../compile-ts.mjs).
//
// Natively supported (not transformed): arrow functions, template literals (also tagged), let/const outside loops,
// default and rest parameters (also through Function.prototype.apply), object spread, array spread, optional chaining, `??`, `**`, logical assignment, numeric
// separators, computed/shorthand properties and methods, Symbol, generators (`yield` also unparenthesized in argument
// lists and before a comma), optional catch binding, BigInt.
// Destructuring, also with rest elements and object rest, works as well, but is lowered anyway (see below).
//
// Transformed, because Rhino lacks or breaks them:
// - class syntax (all of it: Rhino reserves the `class` keyword), class fields, #private, static blocks
// - `const` inside loops (keeps the value of the first iteration), `const` in for-of heads (syntax error), and `let`
//   in loop heads captured by closures (one binding for all iterations)
// - spread in calls and `new` (syntax error)
// - array destructuring (ignores the iterator protocol); the destructuring plugin lowers all patterns, so object rest
//   needs no plugin of its own
// - `new.target` (syntax error)
// - for-of: leaving a loop early (break, return, labelled jumps, throw) does not call the iterator's return(), so a
//   generator's `finally` does not run (own plugin, ./for-of.mjs, with an index-loop fast path for arrays)
// - async functions, async generators and `for await` (Rhino has none of them): lowered to native generators driven by
//   the asyncToGenerator / wrapAsyncGenerator helpers (never regenerator: Rhino's continuations need real generators,
//   generators). `for await` closes its iterator when left early.
// - ES module syntax (import/export): CommonJS, see ./modules.mjs for the interop rules.
//
// Runtime helpers are not inlined: each file imports them from the engine's native `babel-helpers` module (see
// ./external-helpers.mjs and ./helpers.mjs). (The engine's native `tslib` module stays available for code compiled
// by tsc elsewhere.)

import classStaticBlock from "@babel/plugin-transform-class-static-block";
import privatePropertyInObject from "@babel/plugin-transform-private-property-in-object";
import classProperties from "@babel/plugin-transform-class-properties";
import privateMethods from "@babel/plugin-transform-private-methods";
import classes from "@babel/plugin-transform-classes";
import spread from "@babel/plugin-transform-spread";
import destructuring from "@babel/plugin-transform-destructuring";
import blockScoping from "@babel/plugin-transform-block-scoping";
import newTarget from "@babel/plugin-transform-new-target";
import asyncGeneratorFunctions from "@babel/plugin-transform-async-generator-functions";
import asyncToGenerator from "@babel/plugin-transform-async-to-generator";

import externalHelpers from "./external-helpers.mjs";
import forOf from "./for-of.mjs";
import modules from "./modules.mjs";
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
            // The order follows @babel/preset-env (newest syntax first, modules last).
            asyncGeneratorFunctions,
            classStaticBlock,
            privatePropertyInObject,
            classProperties,
            privateMethods,
            asyncToGenerator,
            classes,
            spread,
            // Before destructuring and block scoping: the loop variable becomes a declaration in the loop body, which
            // they then transform.
            forOf,
            destructuring,
            blockScoping,
            newTarget,
            ...modules,
            ...(helpersModule === false ? [] : [[externalHelpers, { moduleName: helpersModule }]]),
        ],
    };
}
