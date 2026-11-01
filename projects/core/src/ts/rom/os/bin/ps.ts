// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// ps — the running programs: PID, PPID, TTY, how long they run (TIME, m:ss) and the command line.

import system from 'system';

/** Milliseconds as m:ss (h:mm:ss from an hour on). */
function duration(ms: number): string {
    let seconds = Math.max(0, Math.floor(ms / 1000));
    let pad = (n: number) => String(n).padStart(2, '0');
    let h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The command line: the program's name (without /rom/…/ and .js) and its arguments. */
function command(info: ProcessInfo): string {
    if (info.pid === 0) return '[os]';
    let [, program = '?', ...args] = info.argv;
    return [program.replace(/^.*\//, '').replace(/\.js$/, ''), ...args].join(' ');
}

export function main(): void {
    let now = Date.now();
    let rows = system.processes().map((info) => [
        String(info.pid), String(info.ppid), String(info.tty), duration(now - info.startTime), command(info),
    ]);
    let header = ['PID', 'PPID', 'TTY', 'TIME', 'CMD'];
    let widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)));
    for (let row of [header, ...rows]) {
        // Numbers right-aligned, the command left as it is.
        console.log(row.map((cell, i) => (i < row.length - 1 ? cell.padStart(widths[i]) : cell)).join('  '));
    }
}
