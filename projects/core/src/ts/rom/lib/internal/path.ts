// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/path.ts — finding programs on PATH (bash, child_process, programs).
//
// PATH lists the directories with programs, separated by ':'; it is not require.paths (the module search path), so a
// program found here is never a native or ROM core module of the same name.

import fs from 'fs';
import * as env from '/rom/lib/env';

/** PATH when it is not set (the OS sets it; this is for programs run without it, e.g. from the bios). */
export const DEFAULT_PATH = '/rom/os/bin:/rom/bin';

/** The directories on PATH. */
export function programDirs(): string[] {
    return (env.get('PATH') ?? DEFAULT_PATH).split(':').filter((dir) => dir.length > 0);
}

/** The path of program `name` (`<dir>/<name>.js` or `<dir>/<name>`) in the first directory of PATH that has it. */
export function findProgram(name: string): string | undefined {
    for (let dir of programDirs()) {
        let base = dir.replace(/\/+$/, '') + '/' + name;
        for (let file of [base + '.js', base]) {
            if (fs.existsSync(file) && !fs.statSync(file).isDirectory()) return base;
        }
    }
    return undefined;
}

/** The names of the programs on PATH (without `.js`), sorted. */
export function programNames(): string[] {
    let names = new Set<string>();
    for (let dir of programDirs()) {
        let entries: string[];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        for (let entry of entries) if (!entry.startsWith('.')) names.add(entry.replace(/\.js$/, ''));
    }
    return [...names].sort();
}
