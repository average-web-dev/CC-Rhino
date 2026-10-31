// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// child_process and os.run: programs run as jobs with their own TTY, argv, working directory and exit code. Run by
// StdioLibraryTest.

import * as prelude from './prelude';
import asyncMod from 'async';
import fs from 'fs';
import { spawn, spawnSync, exec, execSync } from 'child_process';
import os from 'os';

const eq = prelude.eq;

/** Compare arrays and plain objects by value. */
function same(actual: unknown, expected: unknown, message?: string): void {
    eq(JSON.stringify(actual), JSON.stringify(expected), message);
}

// bash (for exec) needs `env` and `util` from /rom/lib, which the test bios does not put on require.paths.
if (require.paths.indexOf('/rom/lib') < 0) require.paths.push('/rom/lib');

fs.mkdirSync('/progs', { recursive: true });
fs.mkdirSync('/progs/sub', { recursive: true });
fs.writeFileSync('/progs/hello.js', `
exports.main = function (args, cwd) {
    process.stdout.write('hello ' + args.join(',') + ' in ' + cwd + '\\n');
    process.stderr.write('to stderr\\n');
    process.chdir('sub');
    process.exitCode = 4;
};`);
fs.writeFileSync('/progs/exit.js', `exports.main = function () { process.exit(3); };`);
fs.writeFileSync('/progs/greet.js', `exports.main = function (args, cwd) { console.log('hi ' + args.join(',') + ' in ' + cwd); };`);
fs.writeFileSync('/progs/fail.js', `exports.main = function () { throw new Error('broken'); };`);
fs.writeFileSync('/progs/echo.js', `
exports.main = function () {
    process.stdin.on('data', function (line) { process.stdout.write('got ' + line); process.exit(0); });
};`);
fs.writeFileSync('/progs/forever.js', `exports.main = function () { require('system').sleep(100000); };`);
fs.writeFileSync('/progs/exitlater.js', `
exports.main = function () {
    setTimeout(function () { process.exit(5); }, 1);
    require('system').sleep(100000);
    console.log('not reached');
};`);
fs.writeFileSync('/progs/exitthread.js', `
exports.main = function () {
    var parallel = require('parallel');
    parallel.spawn(function () { require('system').sleep(1); process.exit(6); });
    require('system').sleep(100000);
};`);

// ── spawnSync ────────────────────────────────────────────────────────────────────────────────────────────────────

let r = spawnSync('/progs/hello.js', ['a', 'b'], { stdio: 'pipe', cwd: '/progs' });
eq(r.status, 4, 'process.exitCode');
eq(r.stdout, 'hello a,b in /progs\n');
eq(r.stderr, 'to stderr\n');
eq(r.error, undefined);
eq(process.cwd(), '/', "a child's chdir does not move the parent");
eq(r.pid > 0, true, 'pid');

eq(spawnSync('/progs/exit.js', [], { stdio: 'pipe' }).status, 3, 'process.exit(3)');
// process.exit ends the program at once, as in Node, also from a callback or another thread while main blocks.
let later = spawnSync('/progs/exitlater.js', [], { stdio: 'pipe' });
eq(later.status, 5, 'process.exit in a timer while main sleeps');
eq(later.stdout, '');
eq(spawnSync('/progs/exitthread.js', [], { stdio: 'pipe' }).status, 6, 'process.exit in a spawned thread');

let failed = spawnSync('/progs/fail.js', [], { stdio: 'pipe' });
eq(failed.status, 1, 'a failing program exits with 1');
eq(/broken/.test(failed.stderr), true, 'and reports its error on its stderr: ' + failed.stderr);

let missing = spawnSync('/progs/missing.js');
eq(missing.status, null);
eq((missing.error as any)?.code, 'ENOENT');

// ── spawn ────────────────────────────────────────────────────────────────────────────────────────────────────────

function waitClose(child: ChildProcess): [number | null, string | null] {
    return asyncMod.unwrap(new Promise<[number | null, string | null]>((resolve) => {
        child.on('close', (code: number | null, signal: string | null) => resolve([code, signal]));
    })) as [number | null, string | null];
}

let child = spawn('/progs/echo.js');
let output = '';
child.stdout!.on('data', (d: string) => { output += d; });
child.stdin!.write('ping\r');
same(waitClose(child), [0, null]);
eq(output, 'ping\ngot ping\n', 'the echo of the typed line, then the answer');
eq(child.exitCode, 0);

let sleeper = spawn('/progs/forever.js');
eq(sleeper.kill(), true);
same(waitClose(sleeper), [null, 'SIGTERM']);
eq(sleeper.killed, true);
eq(sleeper.kill(), false, 'already exited');

// ── exec / execSync (through bash -c) ────────────────────────────────────────────────────────────────────────────

eq(execSync('/progs/greet.js x', { cwd: '/progs' }), 'hi x in /progs\n');
let threw = false;
try { execSync('/progs/exit.js'); } catch (e: any) { threw = true; eq(e.status, 3); }
eq(threw, true, 'execSync throws for a non-zero status');

let execResult = asyncMod.unwrap(new Promise<[Error | null, string]>((resolve) => {
    exec('/progs/hello.js y', { cwd: '/progs' }, (error, stdout) => resolve([error, stdout]));
})) as [Error | null, string];
eq((execResult[0] as any)?.code, 4, 'status 4 is a failure');
eq(execResult[1], 'hello y in /progs\n');

// ── os.run ───────────────────────────────────────────────────────────────────────────────────────────────────────

eq(os.run('/progs/exit.js'), 3);
