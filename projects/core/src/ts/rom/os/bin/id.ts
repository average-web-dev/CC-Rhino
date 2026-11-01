// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// id [peripheral] — the id of this computer, or of the disk in a drive / the computer attached as a peripheral.

import system from 'system';
import peripheral from 'peripheral';

export function main(args: string[]): void {
    let name = args[0];
    if (name === undefined) {
        let label = system.getComputerLabel();
        console.log(`This is computer #${system.getComputerID()}` + (label != null ? ` (${label})` : ''));
        return;
    }
    if (peripheral.hasType(name, 'drive')) {
        let id = peripheral.call(name, 'getDiskID') as number | null;
        if (id == null) fail(`id: ${name}: No disk with an id`); else console.log(`The disk is #${id}`);
    } else if (peripheral.hasType(name, 'computer')) {
        console.log(`The computer is #${peripheral.call(name, 'getID') as number}`);
    } else {
        fail(`id: ${name}: No disk drive or computer`);
    }
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
