// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// monitor — run a program on a monitor, or change a monitor's text scale:
//
//   monitor <name> <program> [args…]     run the program with the monitor's TTY as its stdin/stdout/stderr
//   monitor scale <name> <0.5-5>         set the text scale (in steps of 0.5)
//
// The program draws on the monitor and gets touches as mouse input (after CSI.mouse(true)) and size changes as
// stdout 'resize'; a monitor has no keyboard.

import peripheral from 'peripheral';
import { spawnSync } from 'child_process';

const USAGE = 'Usage: monitor <name> <program> [args…]\n       monitor scale <name> <0.5-5>';

export function main(args: string[]): void {
    if (args[0] === 'scale' && args.length === 3) return scale(args[1], args[2]);
    let [name, program, ...rest] = args;
    if (program === undefined) return fail(USAGE);
    if (!peripheral.hasType(name, 'monitor')) return fail(`monitor: ${name}: No monitor`);
    let tty = peripheral.call(name, 'getTty') as TtyHandle;
    let result = spawnSync(program, rest, { stdio: tty });
    if (result.error !== undefined) return fail(`monitor: ${program}: command not found`);
    process.exitCode = result.status ?? 1;
}

function scale(name: string, value: string): void {
    if (!peripheral.hasType(name, 'monitor')) return fail(`monitor: ${name}: No monitor`);
    let scale = Number(value);
    if (!(scale >= 0.5 && scale <= 5 && scale * 2 === Math.round(scale * 2))) {
        return fail(`monitor: ${value}: Not a scale from 0.5 to 5 in steps of 0.5`);
    }
    peripheral.call(name, 'setTextScale', scale);
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
