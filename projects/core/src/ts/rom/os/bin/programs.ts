// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// programs — the programs bash can run: everything in the directories of PATH, in columns.

import { programNames } from '/rom/lib/internal/path';

export function main(): void {
    let names = programNames();
    if (names.length === 0) return;
    let width = names.reduce((max, name) => Math.max(max, name.length), 0) + 2;
    let perRow = Math.max(1, Math.floor((process.stdout.columns ?? 51) / width));
    for (let i = 0; i < names.length; i += perRow) {
        let row = names.slice(i, i + perRow);
        console.log(row.map((name, j) => (j < row.length - 1 ? name.padEnd(width) : name)).join(''));
    }
}
