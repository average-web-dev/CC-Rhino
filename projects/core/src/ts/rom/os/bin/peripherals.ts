// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/bin/peripherals.ts — list every attached peripheral and its side.

import peripheral from 'peripheral';
import util       from 'util';

export function main(): void {
    // getSides() returns all six physical sides; keep only the ones with something on them.
    let attached = peripheral.getSides().filter(side => peripheral.isPresent(side));

    if (attached.length === 0) {
        console.log('No peripherals attached.');
        return;
    }

    console.log(`Attached peripherals (${attached.length}):`);
    for (let side of attached) {
        let types = peripheral.getType(side) ?? [];
        // Side in lime (an ANSI style, ignored on monochrome terminals), type in white.
        console.log('  ' + util.styleText('greenBright', side) + ': ' + (types.length > 0 ? types.join(', ') : '?'));
    }
}
