// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/search.ts — searching a TextBuffer for a pattern (/, ?, n, N, *, #, :s).
//
// Patterns are JavaScript regular expressions, plus vim's word boundaries \< and \>. 'ignorecase' makes them match
// either case, unless 'smartcase' is on and the pattern has an upper-case letter. Searches wrap around the ends of
// the file ('wrapscan').

import type { Position, TextBuffer } from '/rom/lib/internal/vi/buffer';

/** How a pattern matches: the options that change it. */
export interface SearchOptions {
    ignorecase: boolean;
    smartcase: boolean;
}

/** A pattern as a global RegExp, or an error message (vim's E383) if it is no valid expression. */
export function compile(pattern: string, options: SearchOptions): RegExp | string {
    let source = pattern.replace(/\\[<>]/g, '\\b');
    let ignore = options.ignorecase && !(options.smartcase && /[A-Z]/.test(pattern));
    try {
        return new RegExp(source, ignore ? 'gi' : 'g');
    } catch (e) {
        return `E383: Invalid search string: ${pattern}`;
    }
}

/** The pattern * and # search for: the word under the cursor, as a whole word (if it is made of word characters). */
export function wordPattern(text: string, col: number): string | undefined {
    let start = col;
    let end = col;
    let word = /\w/;
    if (!word.test(text.charAt(col))) {
        // No word character under the cursor: the next word on the line.
        while (end < text.length && !word.test(text.charAt(end))) end++;
        if (end >= text.length) return undefined;
        start = end;
    }
    while (start > 0 && word.test(text.charAt(start - 1))) start--;
    while (end < text.length && word.test(text.charAt(end))) end++;
    let escaped = text.slice(start, end).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `\\<${escaped}\\>`;
}

/** The matches of `regex` on `text`: [start, end) columns (an empty match counts, once per position). */
export function matchesOn(regex: RegExp, text: string): [number, number][] {
    let out: [number, number][] = [];
    regex.lastIndex = 0;
    for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
        out.push([match.index, match.index + match[0].length]);
        if (match[0].length === 0) regex.lastIndex++;
    }
    return out;
}

/** Where a search found its match, and whether it went past the end (or the start) of the file. */
export interface Found {
    pos: Position;
    wrapped: boolean;
}

/** The next match of `regex` after `from` (forward) or before it (backward), or undefined. */
export function search(
    buffer: TextBuffer, regex: RegExp, from: Position, forward: boolean, wrapscan: boolean,
): Found | undefined {
    let count = buffer.lineCount;
    for (let step = 0; step <= count; step++) {
        let offset = forward ? step : -step;
        let raw = from.line + offset;
        let wrapped = raw < 0 || raw >= count;
        if (wrapped && !wrapscan) return undefined;
        let line = ((raw % count) + count) % count;
        let matches = matchesOn(regex, buffer.line(line));
        let hit: [number, number] | undefined;
        if (forward) {
            hit = matches.find(([start]) => step > 0 || start > from.col);
        } else {
            let before = matches.filter(([start]) => step > 0 || start < from.col);
            hit = before[before.length - 1];
        }
        // Back on the starting line after going round: only what lies on the far side of the cursor counts.
        if (hit !== undefined && step === count && (forward ? hit[0] > from.col : hit[0] < from.col)) hit = undefined;
        if (hit !== undefined) return { pos: { line, col: hit[0] }, wrapped };
    }
    return undefined;
}
