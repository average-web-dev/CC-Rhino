// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// redstone — read and set the computer's redstone signals:
//
//   redstone probe                              the input on every side (strength, and bundled channels that are on)
//   redstone set <side> <0-15 | on | off>       set the output strength
//   redstone set <side> <dye> <on | off>        switch one channel of a bundled cable (red, light_blue, …)
//   redstone pulse <side> [count] [period]      switch the output on and off `count` times (default 1), `period`
//                                               seconds each (default 0.5); event driven, it ends with the last pulse

import redstone from 'redstone';
import util from 'util';
import { Dye } from '/rom/lib/color';

const USAGE = [
    'Usage: redstone probe',
    '       redstone set <side> <0-15 | on | off>',
    '       redstone set <side> <dye> <on | off>',
    '       redstone pulse <side> [count] [period]',
].join('\n');

/** The dye ids by lower-case name (red, light_blue, …). */
const DYES: Record<string, Dye> = {};
for (let [name, id] of Object.entries(Dye)) DYES[name.toLowerCase()] = id;

export function main(args: string[]): void {
    let [command, side, ...rest] = args;
    if (command === 'probe' && side === undefined) return probe();
    if (side === undefined || redstone.getSides().indexOf(side as ComputerSide) < 0) {
        return fail(side === undefined ? USAGE : `redstone: ${side}: No such side (${redstone.getSides().join(', ')})`);
    }
    let at = side as ComputerSide;
    if (command === 'set' && rest.length === 1) return setStrength(at, rest[0]);
    if (command === 'set' && rest.length === 2) return setChannel(at, rest[0], rest[1]);
    if (command === 'pulse' && rest.length <= 2) return pulse(at, rest[0] ?? '1', rest[1] ?? '0.5');
    fail(USAGE);
}

function probe(): void {
    let any = false;
    for (let side of redstone.getSides()) {
        let strength = redstone.getAnalogInput(side);
        let bundled = Object.entries(redstone.getBundledInput(side))
            .filter(([, on]) => on)
            .map(([id]) => Object.keys(DYES).find((name) => DYES[name] === Number(id)));
        if (strength === 0 && bundled.length === 0) continue;
        any = true;
        let text = util.styleText('red', side) + ': ' + strength;
        if (bundled.length > 0) text += ' (' + bundled.join(', ') + ')';
        console.log(text);
    }
    if (!any) console.log('No redstone inputs');
}

function setStrength(side: ComputerSide, value: string): void {
    let strength = value === 'on' || value === 'true' ? 15 : value === 'off' || value === 'false' ? 0 : Number(value);
    if (!Number.isInteger(strength) || strength < 0 || strength > 15) return fail(`redstone: ${value}: Not 0-15, on or off`);
    redstone.setAnalogOutput(side, strength);
}

function setChannel(side: ComputerSide, dye: string, value: string): void {
    let id = DYES[dye.toLowerCase()];
    if (id === undefined) return fail(`redstone: ${dye}: No such dye (${Object.keys(DYES).join(', ')})`);
    if (value !== 'on' && value !== 'off') return fail(`redstone: ${value}: Not on or off`);
    redstone.setBundledOutput(side, { [id]: value === 'on' });
}

function pulse(side: ComputerSide, countText: string, periodText: string): void {
    let count = Number(countText);
    let period = Number(periodText);
    if (!Number.isInteger(count) || count < 1) return fail(`redstone: ${countText}: Not a positive count`);
    if (!(period > 0)) return fail(`redstone: ${periodText}: Not a positive number of seconds`);
    let on = false;
    let left = count;
    let toggle = () => {
        on = !on;
        redstone.setOutput(side, on);
        if (!on && --left === 0) return;
        setTimeout(toggle, period * 1000);
    };
    toggle();
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
