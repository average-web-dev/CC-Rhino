// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

import prelude = require('./prelude');

const eq = prelude.eq, matches = prelude.matches, throws = prelude.throws;
const util = require('util');
const asyncMod = require('async');

eq(require('node:util'), util, 'node: prefix');

// ── format ──
eq(util.format('%s:%d:%i:%f', 'a', 42.5, '42.9', '1.5'), 'a:42.5:42:1.5');
eq(util.format('%j', { a: 1 }), '{"a":1}');
const circular: { self?: unknown } = {}; circular.self = circular;
eq(util.format('%j', circular), '[Circular]');
eq(util.format('%O', { a: { b: { c: { d: 1 } } } }), '{ a: { b: { c: [Object] } } }');
eq(util.format('%o', [1]), '[ 1, [length]: 1 ]');
eq(util.format('%c%s', 'color: red', 'x'), 'x');
eq(util.format('100%%'), '100%%', 'a single argument is returned as is');
eq(util.format('%% %s', 'a'), '% a');
eq(util.format('%s %s', 'a'), 'a %s');
eq(util.format('a', 'b', 1, { x: 1 }), 'a b 1 { x: 1 }');
eq(util.format(1, 'x'), '1 x');
eq(util.format('%s', -0), '-0');
eq(util.format('%d', '0x10'), '16');
eq(util.format('%i', 'nope'), 'NaN');
eq(util.format('%s', {}), '{}');
eq(util.format('%s', { toString: function () { return 'T'; } }), 'T');
eq(util.format('%s', [1, [2]]), '[ 1, [Array] ]');
eq(util.format('%s', null), 'null');
eq(util.format('%x', 1), '%x 1', 'unknown placeholders are kept');

// ── inspect ──
eq(util.inspect('a'), "'a'");
eq(util.inspect("it's"), '"it\'s"');
eq(util.inspect('a\nb'), "'a\\nb'");
eq(util.inspect([1, 2, 3]), '[ 1, 2, 3 ]');
eq(util.inspect([]), '[]');
eq(util.inspect({}), '{}');
eq(util.inspect({ a: 1, 'b-c': 2 }), "{ a: 1, 'b-c': 2 }");
eq(util.inspect(circular), '<ref *1> { self: [Circular *1] }');
eq(util.inspect(new Map([['a', 1]])), "Map(1) { 'a' => 1 }");
eq(util.inspect(new Set([1])), 'Set(1) { 1 }');
function named() {}
eq(util.inspect(named), '[Function: named]');
eq(util.inspect([function () {}]), '[ [Function (anonymous)] ]');
eq(util.inspect({ a: { b: { c: {} } } }), '{ a: { b: { c: {} } } }');
eq(util.inspect({ a: { b: 1 } }, { depth: 0 }), '{ a: [Object] }');
eq(util.inspect({ a: { b: { c: { d: 1 } } } }, { depth: null }), '{\n  a: { b: { c: { d: 1 } } }\n}');
eq(util.inspect(Object.create(null)), '[Object: null prototype] {}');
// A constructor function (not a class): inspect shows its name.
function Foo(this: { x: number }) { this.x = 1; }
eq(util.inspect(new (Foo as unknown as new () => { x: number })()), 'Foo { x: 1 }');
eq(util.inspect([1, , 3]), '[ 1, <1 empty item>, 3 ]');
eq(util.inspect(new Date(0)), '1970-01-01T00:00:00.000Z');
eq(util.inspect(/a/g), '/a/g');
eq(util.inspect(-0), '-0');
eq(util.inspect(null), 'null');
eq(util.inspect(undefined), 'undefined');
eq(util.inspect(Symbol('s')), 'Symbol(s)');
eq(util.inspect(new Uint8Array([1, 2])), 'Uint8Array(2) [ 1, 2 ]');
const custom: Record<symbol, () => string> = {};
custom[util.inspect.custom] = function () { return 'CUSTOM'; };
eq(util.inspect({ c: custom }), '{ c: CUSTOM }');
const getter = {};
Object.defineProperty(getter, 'g', { get: function () { return 1; }, enumerable: true });
eq(util.inspect(getter), '{ g: [Getter] }');
eq(util.inspect(getter, { getters: true }), '{ g: [Getter: 1] }');
matches(util.inspect(new Error('boom')), /^Error: boom\n    at /);
eq(util.inspect('x'.repeat(5), { maxStringLength: 2 }), "'xx'... 3 more characters");

const numbers: number[] = [];
for (let i = 0; i < 30; i++) numbers.push(i);
const grouped = util.inspect(numbers).split('\n');
eq(grouped[0], '[');
eq(grouped[1], '   0,  1,  2,  3,  4,  5,  6,  7,  8,');
eq(grouped[grouped.length - 1], ']');
const many: number[] = [];
for (let j = 0; j < 120; j++) many.push(j);
matches(util.inspect(many), /\.\.\. 20 more items\n\]$/);

const wide = util.inspect({ aaaa: 'x'.repeat(30), bbbb: 'y'.repeat(30), cccc: 1 });
eq(wide, "{\n  aaaa: '" + 'x'.repeat(30) + "',\n  bbbb: '" + 'y'.repeat(30) + "',\n  cccc: 1\n}");
eq(util.inspect({ a: [1, 2] }, { breakLength: 3 }), '{\n  a: [\n    1,\n    2\n  ]\n}');

// ── misc ──
eq(util.styleText('red', 'x'), '\x1b[31mx\x1b[39m');
eq(util.styleText(['bold', 'green'], 'x'), '\x1b[1m\x1b[32mx\x1b[39m\x1b[22m');
// Deliberately not a style name.
throws(function () { util.styleText('nope' as StyleName, 'x'); }, 'ERR_INVALID_ARG_VALUE');
eq(util.stripVTControlCharacters('\x1b[31mx\x1b[39m\x1b[2K'), 'x');
eq(util.isDeepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
eq(util.isDeepStrictEqual({ a: 1 }, { a: '1' }), false);
eq(util.isDeepStrictEqual(new Map([[1, 2]]), new Map([[1, 2]])), true);

// util.inherits on constructor functions.
interface Greeter { hello(): string; }
function Base() {}
Base.prototype.hello = function () { return 'hi'; };
function Derived() {}
util.inherits(Derived, Base);
eq(new (Derived as unknown as new () => Greeter)().hello(), 'hi');
eq((Derived as Function & { super_?: Function }).super_, Base);

function double(x: number, callback: (err: Error | null, result?: number) => void) { callback(null, x * 2); }
function fail(callback: (err: Error | null) => void) { callback(new Error('nope')); }
eq(asyncMod.unwrap(util.promisify<number>(double)(21)), 42);
const rejected = throws(function () { asyncMod.unwrap(util.promisify(fail)()); });
eq(rejected.message, 'nope');
