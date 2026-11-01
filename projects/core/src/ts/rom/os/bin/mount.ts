// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// mount — where the disks in the disk drives are mounted (a drive by id, /dev path or side):
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
    // Every drive, on a side or behind a wired modem.
    let any = false;
    for (let drive of peripheral.find('drive')) {
        let path = drive.getMountPath();
        if (path == null) continue;
        any = true;
        let label = drive.getDiskLabel();
        console.log(`${drive.id} on /${path}` + (label != null ? ` (${label})` : ''));
    }
    if (!any) console.log('No disks mounted');
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
