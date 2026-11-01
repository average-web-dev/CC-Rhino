// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// type <path> — whether a path is a file or a directory.

import fs from 'fs';
import { resolve } from '/rom/lib/resolve';

export function main(args: string[], cwd: string): void {
    if (args.length === 0) {
        console.error('Usage: type <path>');
        process.exitCode = 1;
        return;
    }
    for (let arg of args) {
        let path = resolve(cwd, arg);
        if (!fs.existsSync(path)) {
            console.error(`type: ${arg}: No such file or directory`);
            process.exitCode = 1;
            continue;
        }
        console.log(`${arg}: ${fs.statSync(path).isDirectory() ? 'directory' : 'file'}`);
    }
}
