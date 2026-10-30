// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/os.ts — operating-system helpers.
//
//   os.run('edit', ['notes.txt']);                          // run a program here and wait: its exit code
//   os.run('top', [], { tty: TTY.from(monitor.getTty()) }); // … or on another TTY

import { spawnSync } from '/rom/lib/child_process';
import type { TTY } from '/rom/lib/tty';

export interface RunOptions {
    /** The TTY to run on (default: the caller's). */
    tty?: TTY | TtyHandle;
    /** The working directory (default: the caller's). */
    cwd?: string;
}

/**
 * Run a program (a path, or a name on the PATH) and wait for it, as the shell does: on the caller's TTY unless
 * `options.tty` names another. Returns its exit code; throws ENOENT if there is no such program.
 */
export function run(program: string, args: string[] = [], options: RunOptions = {}): number {
    let result = spawnSync(program, args, { stdio: options.tty ?? 'inherit', cwd: options.cwd });
    if (result.error !== undefined) throw result.error;
    return result.status ?? 1;
}
