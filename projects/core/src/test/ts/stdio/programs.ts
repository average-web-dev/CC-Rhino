// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The small programs in /rom/os/bin (#7), run as a shell would and checked by their output. Run by StdioLibraryTest.

import * as prelude from './prelude';
import fs from 'fs';
import redstone from 'redstone';
import system from 'system';
import { spawnSync } from 'child_process';

const eq = prelude.eq;

/** Run /rom/os/bin/<name> with `args`: its exit code and what it wrote (stdout, then stderr). */
function run(name: string, ...args: string[]): { status: number | null; out: string; err: string } {
    let result = spawnSync('/rom/os/bin/' + name, args, { stdio: 'pipe', cwd: '/work', columns: 30 });
    return { status: result.status, out: result.stdout, err: result.stderr };
}

/** Whether `text` matches `pattern`, with the text in the message. */
function matches(text: string, pattern: RegExp, message: string): void {
    eq(pattern.test(text), true, `${message}: ${JSON.stringify(text)}`);
}

fs.mkdirSync('/work/dir', { recursive: true });
fs.writeFileSync('/work/file.txt', 'x');

// type
eq(run('type', 'file.txt', 'dir').out, 'file.txt: file\ndir: directory\n');
let missing = run('type', 'nope');
eq(missing.status, 1);
eq(missing.err, 'type: nope: No such file or directory\n');

// drive
eq(run('drive').out, 'hdd\n');
eq(run('drive', '/rom').out, 'rom\n');
eq(run('drive', 'nope').status, 1);

// id and label
system.setComputerLabel();
matches(run('id').out, /^This is computer #\d+\n$/, 'id');
eq(run('id', 'left').status, 1, 'no drive or computer on the left');
eq(run('label', 'get').out, 'Computer has no label\n');
eq(run('label', 'set', 'Mine').out, 'Computer label set to "Mine"\n');
eq(system.getComputerLabel(), 'Mine');
matches(run('id').out, /^This is computer #\d+ \(Mine\)\n$/, 'id with label');
eq(run('label', 'clear').out, 'Computer label cleared\n');
eq(system.getComputerLabel() ?? null, null);
eq(run('label').status, 1, 'usage');
eq(run('label', 'get', 'left').err, 'label: left: No disk drive\n');

// monitor (no monitor attached in this test; the gametests have real ones)
eq(run('monitor').status, 1, 'usage');
eq(run('monitor', 'left', 'ls').err, 'monitor: left: No monitor\n');
eq(run('monitor', 'scale', 'left', '2').err, 'monitor: left: No monitor\n');

// mount (no drive attached here; moving a disk is a gametest)
eq(run('mount').out, 'No disks mounted\n');
eq(run('mount', 'left', '/floppy').err, 'mount: left: No disk drive\n');
eq(run('mount', 'left').status, 1, 'usage');

// time and about
matches(run('time').out, /^The time is \d{1,2}:\d\d [AP]M on Day \d+\n$/, 'time');
eq(run('about').out.split('\n')[0].indexOf(system.getHost()) >= 0, true, 'about names the host');

// programs: the programs on PATH in columns
process.env.PATH = '/rom/os/bin';
let programs = run('programs').out;
matches(programs, /^about +cat\n/, 'columns');
eq(programs.indexOf('readline'), -1, 'no libraries');

// A bare name is looked up on PATH only: `redstone` is the program, although there is a native module of that name.
let byName = spawnSync('redstone', ['set', 'top', '3'], { stdio: 'pipe' });
eq(byName.status, 0, byName.stderr);
eq(redstone.getAnalogOutput('top'), 3);
eq(spawnSync('fs', [], { stdio: 'pipe' }).error?.message, 'spawn fs ENOENT', 'a module is no program');
eq(programs.split('\n').every((line) => line.length <= 30), true, 'fits the width');

// redstone
eq(run('redstone', 'set', 'top', '7').status, 0);
eq(redstone.getAnalogOutput('top'), 7);
run('redstone', 'set', 'top', 'off');
eq(redstone.getAnalogOutput('top'), 0);
run('redstone', 'set', 'back', 'red', 'on');
eq(redstone.getBundledOutput('back')[14], true, 'bundled red');
run('redstone', 'set', 'back', 'red', 'off');
eq(redstone.getBundledOutput('back')[14], false);
eq(run('redstone', 'set', 'top', '16').status, 1);
eq(run('redstone', 'set', 'up', '1').err.indexOf('redstone: up: No such side') === 0, true);
eq(run('redstone', 'probe').out, 'No redstone inputs\n');
// pulse: on and off again, the program ends with the last pulse.
let start = system.clock();
eq(run('redstone', 'pulse', 'left', '2', '0.1').status, 0);
eq(redstone.getOutput('left'), false, 'off after pulsing');
eq(system.clock() - start >= 0.29, true, 'on, off, on, off 0.1 s apart (no wait after the last): ' + (system.clock() - start));
