// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// mount — where the disks in the disk drives are mounted:
//
//   mount                      list the drives with a disk and where it is mounted
//   mount <drive> <path>       mount the drive's disks at <path> (now, and the disks inserted later)
//   mount <drive> --default    back to the default place (/mnt/disk, /mnt/disk2, …)

import peripheral from 'peripheral';
import { resolve } from '/rom/lib/resolve';

const USAGE = 'Usage: mount [<drive> <path> | <drive> --default]';

export function main(args: string[], cwd: string): void {
    if (args.length === 0) return list();
    let [drive, path] = args;
    if (path === undefined || args.length > 2) return fail(USAGE);
    if (!peripheral.hasType(drive, 'drive')) return fail(`mount: ${drive}: No disk drive`);
    let mounted: string | null;
    try {
        mounted = peripheral.call(drive, 'setMountPath', path === '--default' ? undefined : resolve(cwd, path)) as
            string | null;
    } catch (error: any) {
        return fail(`mount: ${error?.message ?? error}`);
    }
    if (mounted == null) console.log(`No disk in ${drive}; its disks will be mounted there`);
}

function list(): void {
    let drives = attached().filter((name) => peripheral.hasType(name, 'drive'));
    let any = false;
    for (let drive of drives) {
        let path = peripheral.call(drive, 'getMountPath') as string | null;
        if (path == null) continue;
        any = true;
        let label = peripheral.call(drive, 'getDiskLabel') as string | null;
        console.log(`${drive} on /${path}` + (label != null ? ` (${label})` : ''));
    }
    if (!any) console.log('No disks mounted');
}

/** The attached peripherals: on the sides, and behind wired modems. */
function attached(): string[] {
    let names: string[] = [];
    for (let side of peripheral.getSides()) {
        if (!peripheral.isPresent(side)) continue;
        names.push(side);
        if (peripheral.hasType(side, 'peripheral_hub')) {
            names.push(...(peripheral.call(side, 'getNamesRemote') as string[]));
        }
    }
    return names;
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
