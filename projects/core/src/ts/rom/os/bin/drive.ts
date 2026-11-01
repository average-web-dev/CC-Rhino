// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// drive [path] — the drive a path is on: hdd (the computer's own), rom, or the mount of a disk.

import fs from 'fs';
import { resolve } from '/rom/lib/resolve';

export function main(args: string[], cwd: string): void {
    let path = resolve(cwd, args[0] ?? '.');
    let drive = fs.existsSync(path) ? fs.getDrive(path) : null;
    if (drive == null) {
        console.error(`drive: ${args[0] ?? cwd}: No such file or directory`);
        process.exitCode = 1;
        return;
    }
    console.log(drive);
}
