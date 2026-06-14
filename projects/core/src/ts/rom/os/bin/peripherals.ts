// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/bin/peripherals.ts — list every attached peripheral and its side.

const peripheral = require('peripheral');
const term       = require('term');

function main(): void {
    const canColor = term.isColor();

    // getSides() returns all six physical sides; keep only the ones with something on them.
    const attached = peripheral.getSides().filter(side => peripheral.isPresent(side));

    if (attached.length === 0) {
        print('No peripherals attached.');
        return;
    }

    print(`Attached peripherals (${attached.length}):`);
    for (let side of attached) {
        let types = peripheral.getType(side) ?? [];
        if (canColor) term.setTextColor(32);   // lime — side
        write('  ' + side);
        if (canColor) term.setTextColor(1);     // white — type
        print(': ' + (types.length > 0 ? types.join(', ') : '?'));
    }
}

export = {
    main,
}
