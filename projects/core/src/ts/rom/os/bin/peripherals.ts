// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/bin/peripherals.ts — list every attached device: its id, its types, its /dev path and the side it is on
// (devices behind a wired modem have none).

import peripheral from 'peripheral';
import util       from 'util';

const SIDES = ['bottom', 'top', 'back', 'front', 'right', 'left'];

export function main(): void {
    let devices = peripheral.list();
    if (devices.length === 0) {
        console.log('No peripherals attached.');
        return;
    }

    let sides = new Map<string, string>();
    for (let side of SIDES) {
        let id = peripheral.getDeviceOn(side);
        if (id !== null) sides.set(id, side);
    }

    console.log(`Attached peripherals (${devices.length}):`);
    for (let device of devices) {
        let where = [device.path, sides.get(device.id)].filter((w) => w !== undefined).join(', ');
        // Id in lime (an ANSI style, ignored on monochrome terminals), types in white.
        console.log('  ' + util.styleText('greenBright', device.id) + ': ' + device.types.join(', ')
            + (where !== '' ? ` (${where})` : ''));
    }
}
