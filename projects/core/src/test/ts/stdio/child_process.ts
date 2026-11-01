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
fs.writeFileSync('/progs/onexit.js', `
exports.main = function (args) {
    process.on('exit', function (code) { console.log('exit ' + code + ' ' + process.argv[2]); });
    var gone = function () { console.log('removed'); };
    process.on('exit', gone);
    process.off('exit', gone);
    process.once('exit', function (code) { if (args[0] === 'change') process.exitCode = 9; });
    if (args[0] === 'exit') process.exit(2);
    if (args[0] === 'fail') throw new Error('failed');
    if (args[0] === 'listener') process.on('exit', function () { throw new Error('in listener'); });
    if (args[0] === 'reexit') process.on('exit', function () { process.exit(7); });
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

// process.on('exit'): called with the code when the program ends, in its context; it may change the code.
let onExit = (arg: string) => spawnSync('/progs/onexit.js', [arg], { stdio: 'pipe' });
let ended = onExit('normal');
eq(ended.status, 0);
eq(ended.stdout, 'exit 0 normal\n', "the listener runs once, as the program (process.argv); off() removed the other");
eq(onExit('exit').stdout, 'exit 2 exit\n', 'after process.exit(2)');
eq(onExit('change').status, 9, 'a listener may set process.exitCode');
eq(onExit('reexit').status, 7, 'or call process.exit(code)');
let failedExit = onExit('fail');
eq(failedExit.status, 1);
eq(failedExit.stdout, 'exit 1 fail\n', 'listeners also run when the program failed');
eq(/failed/.test(failedExit.stderr), true, failedExit.stderr);
let listenerFailed = onExit('listener');
eq(listenerFailed.status, 1, 'a listener that throws fails the program');
eq(/in listener/.test(listenerFailed.stderr), true, listenerFailed.stderr);
let rejected = false;
try { (process as any).on('SIGINT', () => {}); } catch (e: any) { rejected = e.code === 'ERR_INVALID_ARG_VALUE'; }
eq(rejected, true, "'exit' is the only process event");

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
