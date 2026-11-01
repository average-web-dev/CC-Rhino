// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The process table (#60): system.processes() / process(pid), its events, process.ppid / process.kill with signals,
// and the ps / kill programs. Run by StdioLibraryTest.

import * as prelude from './prelude';
import asyncMod from 'async';
import fs from 'fs';
import system, { Signal } from 'system';
import { spawn, spawnSync, type ChildProcess } from 'child_process';

const eq = prelude.eq;

// bash (for the programs) needs `env` from /rom/lib, which the test bios does not put on require.paths.
if (require.paths.indexOf('/rom/lib') < 0) require.paths.push('/rom/lib');

/** Whether calling `fn` throws an error with `code`. */
function throwsCode(fn: () => unknown, code: string): boolean {
    try {
        fn();
        return false;
    } catch (e: any) {
        return e?.code === code;
    }
}

function waitExit(child: ChildProcess): [number | null, string | null] {
    return asyncMod.unwrap(new Promise<[number | null, string | null]>((resolve) => {
        child.on('exit', (code: number | null, signal: string | null) => resolve([code, signal]));
    })) as [number | null, string | null];
}

fs.mkdirSync('/progs', { recursive: true });
fs.writeFileSync('/progs/sleeper.js', `
exports.main = function () {
    process.on('exit', function (code) { require('fs').writeFileSync('/progs/exit-' + process.pid, String(code)); });
    require('system').sleep(100000);
};`);

// The root process (the test bios) is pid 0.
eq(process.pid, 0);
eq(system.process(0)?.argv[0], 'bash');
eq(system.process(12345), undefined);

// system.processes() / process(pid), and the events.
let started: number[] = [];
let ended: string[] = [];
system.on('processStart', (info) => started.push(info.pid));
system.on('processEnd', (info, code) => ended.push(info.pid + ':' + code));

let child = spawn('/progs/sleeper.js', ['a'], { stdio: 'pipe', cwd: '/progs' });
system.sleep(2);
let info = system.process(child.pid);
eq(info?.ppid, 0, 'started by the test');
eq(info?.argv.slice(2).join(), 'a');
eq(info?.cwd, '/progs');
eq(typeof info?.startTime, 'number');
eq(system.processes().map((p) => p.pid).indexOf(child.pid) >= 0, true);
eq(started.indexOf(child.pid) >= 0, true, 'processStart');

// process.kill: SIGTERM by default, exit code 143, the exit listeners run.
eq(process.kill(child.pid, 0), true, 'signal 0 only tests');
eq(process.kill(child.pid), true);
eq(waitExit(child).join(), ',SIGTERM');
eq(fs.readFileSync('/progs/exit-' + child.pid, 'utf8'), '143', 'exit listeners see 143');
eq(system.process(child.pid), undefined, 'gone from the table');
eq(ended.indexOf(child.pid + ':143') >= 0, true, 'processEnd with the code');

// SIGKILL: 137, no exit listeners.
let killed = spawn('/progs/sleeper.js', [], { stdio: 'pipe' });
system.sleep(2);
eq(killed.kill(Signal.SIGKILL), true);
eq(waitExit(killed).join(), ',SIGKILL');
eq(fs.existsSync('/progs/exit-' + killed.pid), false, 'no exit listeners after SIGKILL');

// SIGINT by number.
let interrupted = spawn('/progs/sleeper.js', [], { stdio: 'pipe' });
system.sleep(2);
process.kill(interrupted.pid, Signal.SIGINT);
eq(waitExit(interrupted).join(), ',SIGINT');

// Signal is a constant group of numbers, as on Linux; Node's names work too.
eq(Signal.SIGTERM, 15);
eq(Object.isFrozen(Signal), true);
let byName = spawn('/progs/sleeper.js', [], { stdio: 'pipe' });
system.sleep(2);
process.kill(byName.pid, 'SIGKILL');
eq(waitExit(byName).join(), ',SIGKILL', 'by name');

// Errors, as in Node.
eq(throwsCode(() => process.kill(12345), 'ESRCH'), true);
eq(throwsCode(() => process.kill(0), 'EPERM'), true, 'not the root process');
eq(throwsCode(() => process.kill(0, 'SIGHUP' as any), 'ERR_UNKNOWN_SIGNAL'), true);

// ps and kill.
let sleeper = spawn('/progs/sleeper.js', [], { stdio: 'pipe' });
system.sleep(2);
let ps = spawnSync('/rom/os/bin/ps', [], { stdio: 'pipe' }).stdout;
eq(/^\s*PID\s+PPID\s+TTY\s+TIME\s+CMD\n/.test(ps), true, ps);
eq(new RegExp('\\n\\s*' + sleeper.pid + '\\s+0\\s+\\d+\\s+0:0\\d\\s+sleeper\\n').test(ps), true, ps);
eq(/\n\s*0\s+0\s+\d+\s+\S+\s+\[os\]\n/.test(ps), true, 'the root process: ' + ps);
let killRun = spawnSync('/rom/os/bin/kill', ['-9', String(sleeper.pid)], { stdio: 'pipe' });
eq(killRun.status, 0, killRun.stderr);
eq(waitExit(sleeper).join(), ',SIGKILL');
eq(spawnSync('/rom/os/bin/kill', ['12345'], { stdio: 'pipe' }).stderr, 'kill: (12345) - No such process\n');
eq(spawnSync('/rom/os/bin/kill', ['-l'], { stdio: 'pipe' }).stdout, '2) SIGINT  9) SIGKILL  15) SIGTERM\n');

// ── system.formatTime: a time of day, 12- or 24-hour ───────────────────────────────────────────────────────────────

eq(system.formatTime(0), '12:00 AM');
eq(system.formatTime(6.5), '6:30 AM');
eq(system.formatTime(18.5), '6:30 PM');
eq(system.formatTime(12.25), '12:15 PM');
eq(system.formatTime(24), '12:00 AM', 'wraps at 24');
eq(system.formatTime(18.5, false), '18:30');
eq(system.formatTime(0.05, false), '0:03');
eq(typeof system.formatTime(), 'string', 'now by default');
prelude.throws(() => system.formatTime('6' as any), 'ERR_INVALID_ARG_TYPE');
