// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The globals and modules are the same objects.
eq(require('console'), console);
eq(require('node:console'), console);
eq(require('process'), process);
eq(typeof console.Console, 'function');
eq(Object.getOwnPropertyDescriptor(globalThis, 'console').enumerable, false);
eq(typeof print, 'undefined', 'print is gone');
eq(typeof write, 'undefined', 'write is gone');

function fresh(options) {
    var out = sink(80), err = sink(80);
    var opts = { stdout: out, stderr: err };
    if (options) for (var key in options) opts[key] = options[key];
    return { c: new console.Console(opts), out: out, err: err };
}

// log / error / warn and formatting
var t = fresh();
t.c.log('a', 1, { b: 2 });
t.c.info('%s=%d', 'x', 3);
t.c.error('e');
t.c.warn('w');
eq(t.out.out, 'a 1 { b: 2 }\nx=3\n');
eq(t.err.out, 'e\nw\n');

// Methods are bound, as in Node.
var log = t.c.log;
log('bound');
matches(t.out.out, /bound\n$/);

// The (stdout, stderr) signature
var out2 = sink(80);
new console.Console(out2).error('to stdout');
eq(out2.out, 'to stdout\n');

// group indentation
t = fresh();
t.c.group('G');
t.c.log('x\ny');
t.c.group();
t.c.log('deep');
t.c.groupEnd();
t.c.groupEnd();
t.c.log('z');
eq(t.out.out, 'G\n  x\n  y\n    deep\nz\n');
t = fresh({ groupIndentation: 4 });
t.c.group();
t.c.log('four');
eq(t.out.out, '    four\n');

// count
t = fresh();
t.c.count();
t.c.count();
t.c.count('k');
t.c.countReset();
t.c.count();
eq(t.out.out, 'default: 1\ndefault: 2\nk: 1\ndefault: 1\n');

// time
t = fresh();
t.c.time('t');
t.c.timeLog('t', 'extra');
t.c.timeEnd('t');
matches(t.out.out, /^t: \d+(\.\d+)?ms extra\nt: \d+(\.\d+)?ms\n$/);

// assert
t = fresh();
t.c.assert(true, 'never');
t.c.assert(false, 'x %s', 'y');
t.c.assert(false);
eq(t.err.out, 'Assertion failed: x y\nAssertion failed\n');

// dir
t = fresh();
t.c.dir({ a: { b: { c: { d: 1 } } } }, { depth: 0 });
eq(t.out.out, '{ a: [Object] }\n');

// trace
t = fresh();
t.c.trace('hi %d', 1);
matches(t.err.out, /^Trace: hi 1\n    at /);

// table
t = fresh();
t.c.table([{ a: 1, b: 'x' }, { a: 2 }]);
eq(t.out.out, [
    '+---------+---+-----+',
    '| (index) | a |  b  |',
    '+---------+---+-----+',
    '|    0    | 1 | \'x\' |',
    '|    1    | 2 |     |',
    '+---------+---+-----+',
    '',
].join('\n'));
t = fresh();
t.c.table([1, 'two']);
eq(t.out.out, [
    '+---------+--------+',
    '| (index) | Values |',
    '+---------+--------+',
    '|    0    |   1    |',
    '|    1    | \'two\'  |',
    '+---------+--------+',
    '',
].join('\n'));
t = fresh();
t.c.table('plain');
eq(t.out.out, 'plain\n');

// Inspected values break at the stream's width.
var narrow = sink(20);
new console.Console(narrow).log({ alpha: 1, beta: 2, gamma: 3 });
eq(narrow.out, '{\n  alpha: 1,\n  beta: 2,\n  gamma: 3\n}\n');

// Write errors are ignored unless asked otherwise.
var broken = { write: function () { throw new Error('broken'); } };
new console.Console(broken).log('ignored');
throws(function () { new console.Console({ stdout: broken, ignoreErrors: false }).log('thrown'); });

throws(function () { new console.Console({}); }, 'ERR_CONSOLE_WRITABLE_STREAM');
