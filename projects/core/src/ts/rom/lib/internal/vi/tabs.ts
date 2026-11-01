// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/tabs.ts — screen columns of text with tabs: a tab reaches the next multiple of TAB_WIDTH.

/** The width of a tab on screen. */
export const TAB_WIDTH = 4;

/** The screen column (from 0) of column `col` of `line`, tabs expanded. */
export function displayCol(line: string, col: number): number {
    let x = 0;
    for (let i = 0; i < col && i < line.length; i++) x += line.charAt(i) === '\t' ? TAB_WIDTH - (x % TAB_WIDTH) : 1;
    return x;
}

/** The column of `line` shown at screen column `x` (or the last one before it). */
export function colAtDisplay(line: string, x: number): number {
    let at = 0;
    for (let i = 0; i < line.length; i++) {
        let next = at + (line.charAt(i) === '\t' ? TAB_WIDTH - (at % TAB_WIDTH) : 1);
        if (next > x) return i;
        at = next;
    }
    return line.length;
}

/** `line` with its tabs expanded to spaces. */
export function expandTabs(line: string): string {
    if (line.indexOf('\t') < 0) return line;
    let out = '';
    for (let ch of line) out += ch === '\t' ? ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : ch;
    return out;
}
