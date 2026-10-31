// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// chvt <n> — show virtual console n (1 … the number of consoles), like Alt+n.

import screen from 'screen';

export function main(args: string[]): void {
    let n = Number(args[0]);
    let count = screen.getConsoleCount();
    if (!Number.isInteger(n) || n < 1 || n > count) {
        console.error(count > 1 ? `Usage: chvt <1-${count}>` : 'chvt: this computer has a single console');
        process.exitCode = 1;
        return;
    }
    screen.show(n - 1);
}
