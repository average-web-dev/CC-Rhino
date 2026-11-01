// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// label — the label of this computer, or of the disk in a drive:
//
//   label get [drive]          label set <text> [drive]          label clear [drive]

import system from 'system';
import peripheral from 'peripheral';

const USAGE = 'Usage: label get [drive] | label set <text> [drive] | label clear [drive]';

export function main(args: string[]): void {
    let [command, ...rest] = args;
    let drive = command === 'set' ? rest[1] : rest[0];
    if (drive !== undefined && !peripheral.hasType(drive, 'drive')) return fail(`label: ${drive}: No disk drive`);
    if (drive !== undefined && !peripheral.call(drive, 'isDiskPresent')) return fail(`label: ${drive}: No disk`);
    let what = drive === undefined ? 'Computer' : 'Disk';
    let get = (): string | null => (drive === undefined
        ? system.getComputerLabel() : peripheral.call(drive, 'getDiskLabel') as string | null);
    let set = (label?: string) => {
        if (drive === undefined) system.setComputerLabel(label); else peripheral.call(drive, 'setDiskLabel', label);
    };

    switch (command) {
        case 'get': {
            let label = get();
            console.log(label == null ? `${what} has no label` : `${what} label is "${label}"`);
            return;
        }
        case 'set':
            if (rest[0] === undefined || rest.length > 2) return fail(USAGE);
            set(rest[0]);
            console.log(`${what} label set to "${get()}"`);
            return;
        case 'clear':
            set();
            console.log(`${what} label cleared`);
            return;
        default:
            fail(USAGE);
    }
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
