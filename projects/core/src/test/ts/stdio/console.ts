// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

import * as prelude from './prelude';

const eq = prelude.eq, matches = prelude.matches, throws = prelude.throws, sink = prelude.sink;

// The globals and modules are the same objects.
eq(require('console'), console);
eq(require('node:console'), console);
eq(require('process'), process);
eq(typeof console.Console, 'function');
eq(Object.getOwnPropertyDescriptor(globalThis, 'console')!.enumerable, false);
// Not declared as globals, so look them up through the global object.
const globals = globalThis as unknown as Record<string, unknown>;
eq(typeof globals.print, 'undefined', 'print is gone');
eq(typeof globals.write, 'undefined', 'write is gone');

function fresh(groupIndentation?: number) {
    let out = sink(80), err = sink(80);
    let opts: ConsoleOptions = { stdout: out, stderr: err };
    if (groupIndentation !== undefined) opts.groupIndentation = groupIndentation;
    return { c: new console.Console(opts), out: out, err: err };
}

// log / error / warn and formatting
let t = fresh();
t.c.log('a', 1, { b: 2 });
t.c.info('%s=%d', 'x', 3);
t.c.error('e');
t.c.warn('w');
eq(t.out.out, 'a 1 { b: 2 }\nx=3\n');
eq(t.err.out, 'e\nw\n');

// Methods are bound, as in Node.
const log = t.c.log;
log('bound');
matches(t.out.out, /bound\n$/);

// The (stdout, stderr) signature
const out2 = sink(80);
new console.Console(out2).error('to stdout');
eq(out2.out, 'to stdout\n');

// Console is a class (#47), but like Node's it also works without `new`, and can be extended.
const ConsoleCtor = console.Console;
eq(console instanceof ConsoleCtor, true, 'the global console is a Console');
eq(console.constructor, ConsoleCtor);
eq(ConsoleCtor.name, 'Console');
const out3 = sink(80);
const called = ConsoleCtor({ stdout: out3 });
eq(called instanceof ConsoleCtor, true, 'Console() without new');
called.log('called');
eq(out3.out, 'called\n');
eq(Object.keys(ConsoleCtor.prototype).slice(0, 6).join(), 'log,info,debug,dirxml,warn,error', 'methods are enumerable');
eq(ConsoleCtor.prototype.info, ConsoleCtor.prototype.log, 'info is log');
eq(ConsoleCtor.prototype.error, ConsoleCtor.prototype.warn, 'error is warn');
class TaggedConsole extends ConsoleCtor {
    tagged(...data: unknown[]): void {
        this.log('[tag]', ...data);
    }
}
const out4 = sink(80);
const tagged = new TaggedConsole({ stdout: out4 });
eq(tagged instanceof TaggedConsole && tagged instanceof ConsoleCtor, true, 'subclass instances');
tagged.tagged('x', 1);
eq(out4.out, '[tag] x 1\n');

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
t = fresh(4);
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
const narrow = sink(20);
new console.Console(narrow).log({ alpha: 1, beta: 2, gamma: 3 });
eq(narrow.out, '{\n  alpha: 1,\n  beta: 2,\n  gamma: 3\n}\n');

// Write errors are ignored unless asked otherwise.
const broken: Writable = { write: function () { throw new Error('broken'); } };
new console.Console(broken).log('ignored');
throws(function () { new console.Console({ stdout: broken, ignoreErrors: false }).log('thrown'); });

// Deliberately invalid options: there is no stdout.
throws(function () { new console.Console({} as ConsoleOptions); }, 'ERR_CONSOLE_WRITABLE_STREAM');
