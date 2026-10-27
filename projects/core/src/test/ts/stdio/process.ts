// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

import prelude = require('./prelude');

const eq = prelude.eq, throws = prelude.throws;
const env = require('/rom/lib/env');
const fs = require('fs');
const asyncMod = require('async');

eq(require('node:process'), process);
eq(process.platform, 'computercraft');
eq(process.argv[0], 'bash');
eq(process.stdout.isTTY, true);
eq(process.stdin.isTTY, true);
eq(process.stdout.columns, 51);
eq(process.stdout.rows, 19);
eq(JSON.stringify(process.stdout.getWindowSize()), '[51,19]');
eq(process.stdout.hasColors(), true);
eq(process.stdout.getColorDepth(), 4);

// env is a live view of the env module (PATH mirrors require.paths). Values are converted to strings, as in Node.
(process.env as Record<string, unknown>).GREETING = 42;
eq(env.get('GREETING'), '42');
eq(process.env.GREETING, '42');
eq('GREETING' in process.env, true);
assert(Object.keys(process.env).indexOf('GREETING') !== -1, 'env keys');
delete process.env.GREETING;
eq(process.env.GREETING, undefined);
eq(env.has('GREETING'), false);
eq(process.env.PATH, require.paths.join(':'));

// cwd / chdir
eq(process.cwd(), '/');
fs.mkdirSync('/work/sub', { recursive: true });
fs.writeFileSync('/work/file', 'x');
process.chdir('work');
eq(process.cwd(), '/work');
process.chdir('sub/..');
eq(process.cwd(), '/work');
throws(function () { process.chdir('/nope'); }, 'ENOENT');
throws(function () { process.chdir('file'); }, 'ENOTDIR');
process.chdir('/');

// nextTick runs as a microtask, with arguments.
const ticked: number[] = [];
process.nextTick(function (a: number, b: number) { ticked.push(a + b); }, 1, 2);
eq(ticked.length, 0);
asyncMod.unwrap(Promise.resolve());
eq(ticked.join(), '3');

const start = process.hrtime();
eq(start.length, 2);
const diff = process.hrtime(start);
assert(diff[0] >= 0 && diff[1] >= 0 && diff[1] < 1e9, 'hrtime diff');
eq(typeof process.hrtime.bigint(), 'bigint');
eq(typeof process.uptime(), 'number');

// stdin starts out not flowing, in cooked mode.
eq(process.stdin.readableFlowing, null);
eq(process.stdin.isRaw, false);
eq(process.stdin.setRawMode(true), process.stdin);
eq(process.stdin.isRaw, true);
process.stdin.setRawMode(false);
