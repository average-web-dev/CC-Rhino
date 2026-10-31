// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The ROM's Node-style errors and argument validators (/rom/lib/internal/errors, /rom/lib/internal/validators): codes,
// classes and Node's message texts. Run by StdioLibraryTest.

import * as prelude from './prelude';

const eq = prelude.eq, throws = prelude.throws;
// Plain requires of ROM internals (an import would pull the ROM source into the test program), so untyped.
const errors: any = require('/rom/lib/internal/errors');
const v: any = require('/rom/lib/internal/validators');

// ── Messages, as Node words them ─────────────────────────────────────────────────

let e = new errors.ERR_INVALID_ARG_TYPE('callback', 'function', 5);
eq(e instanceof TypeError, true);
eq(e.name, 'TypeError');
eq(e.code, 'ERR_INVALID_ARG_TYPE');
eq(e.message, 'The "callback" argument must be of type function. Received type number (5)');
eq(new errors.ERR_INVALID_ARG_TYPE('chunk', ['string', 'Uint8Array'], null).message,
    'The "chunk" argument must be of type string or an instance of Uint8Array. Received null');
eq(new errors.ERR_INVALID_ARG_TYPE('x', ['object', 'string', 'number'], 'it\'s').message,
    'The "x" argument must be one of type string, number, or object. Received type string ("it\'s")');
eq(new errors.ERR_INVALID_ARG_TYPE('options.x', 'Array', new Map()).message,
    'The "options.x" property must be an instance of Array. Received an instance of Map');
eq(new errors.ERR_INVALID_ARG_TYPE('input', 'a readable stream', function f() { /* */ }).message,
    'The "input" argument must be a readable stream. Received function f');
eq(new errors.ERR_INVALID_ARG_TYPE('s', 'number', 'abcdefghijklmnopqrstuvwxyz0123').message,
    'The "s" argument must be of type number. Received type string (\'abcdefghijklmnopqrstuvwxy...\')');

e = new errors.ERR_INVALID_ARG_VALUE('format', 'nope', 'must be one of: red');
eq(e instanceof TypeError, true);
eq(e.code, 'ERR_INVALID_ARG_VALUE');
eq(e.message, "The argument 'format' must be one of: red. Received 'nope'");
eq(new errors.ERR_INVALID_ARG_VALUE('options.stdio', 3).message, "The property 'options.stdio' is invalid. Received 3");

e = new errors.ERR_OUT_OF_RANGE('n', '>= 0 && <= 10', 11);
eq(e instanceof RangeError, true);
eq(e.code, 'ERR_OUT_OF_RANGE');
eq(e.message, 'The value of "n" is out of range. It must be >= 0 && <= 10. Received 11');
eq(new errors.ERR_OUT_OF_RANGE('n', 'small', 2 ** 40).message,
    'The value of "n" is out of range. It must be small. Received 1_099_511_627_776');

eq(new errors.ERR_MISSING_ARGS('a').message, 'The "a" argument must be specified');
eq(new errors.ERR_MISSING_ARGS('a', 'b').message, 'The "a" and "b" arguments must be specified');
eq(new errors.ERR_MISSING_ARGS('a', 'b', 'c').message, 'The "a", "b", and "c" arguments must be specified');

e = new errors.AbortError();
eq(e.name, 'AbortError');
eq(e.code, 'ABORT_ERR');
eq(e.message, 'The operation was aborted');
eq(new errors.ERR_USE_AFTER_CLOSE('readline').message, 'readline was closed');
eq(new errors.ERR_UNHANDLED_ERROR('boom').context, 'boom');

// ── Validators ───────────────────────────────────────────────────────────────────

v.validateString('x', 'a');
throws(() => v.validateString(1, 'a'), 'ERR_INVALID_ARG_TYPE');
v.validateBoolean(false, 'a');
throws(() => v.validateBoolean(0, 'a'), 'ERR_INVALID_ARG_TYPE');
v.validateFunction(() => 1, 'a');
throws(() => v.validateFunction({}, 'a'), 'ERR_INVALID_ARG_TYPE');

v.validateNumber(NaN, 'a');
v.validateNumber(5, 'a', 0, 5);
throws(() => v.validateNumber('5', 'a'), 'ERR_INVALID_ARG_TYPE');
eq(throws(() => v.validateNumber(-1, 'a', 0), 'ERR_OUT_OF_RANGE').message,
    'The value of "a" is out of range. It must be >= 0. Received -1');
throws(() => v.validateNumber(NaN, 'a', 0, 1), 'ERR_OUT_OF_RANGE');

v.validateInteger(3, 'a', 0, 3);
eq(throws(() => v.validateInteger(1.5, 'a'), 'ERR_OUT_OF_RANGE').message,
    'The value of "a" is out of range. It must be an integer. Received 1.5');
throws(() => v.validateInteger(4, 'a', 0, 3), 'ERR_OUT_OF_RANGE');

v.validateObject({}, 'a');
throws(() => v.validateObject(null, 'a'), 'ERR_INVALID_ARG_TYPE');
throws(() => v.validateObject([], 'a'), 'ERR_INVALID_ARG_TYPE');
v.validateObject(null, 'a', { nullable: true });
v.validateObject([], 'a', { allowArray: true });
v.validateObject(() => 1, 'a', { allowFunction: true });

v.validateArray([1], 'a', 1);
throws(() => v.validateArray({}, 'a'), 'ERR_INVALID_ARG_TYPE');
throws(() => v.validateArray([], 'a', 1), 'ERR_INVALID_ARG_VALUE');

v.validateOneOf('b', 'a', ['a', 'b']);
eq(throws(() => v.validateOneOf('c', 'mode', ['a', 1]), 'ERR_INVALID_ARG_VALUE').message,
    "The argument 'mode' must be one of: 'a', 1. Received 'c'");

// ── ROM functions use them ───────────────────────────────────────────────────────

throws(() => process.chdir(5 as any), 'ERR_INVALID_ARG_TYPE');
throws(() => queueMicrotask(5 as any), 'ERR_INVALID_ARG_TYPE');
throws(() => new console.Console({ stdout: process.stdout, groupIndentation: 2000 }), 'ERR_OUT_OF_RANGE');
throws(() => console.table([], 'x' as any), 'ERR_INVALID_ARG_TYPE');
