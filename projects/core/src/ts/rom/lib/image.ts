// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/image.ts — `image`: pixels, lines, boxes and images on a Term (#3; CraftOS's paintutils and cc.image.nft).
//
//   image.drawLine(term, { x: 0, y: 0 }, new Point(10, 4), ColorIndex.RED)
//   image.drawImage(term, image.loadNfp('/logo.nfp'), { x: 2, y: 1 })
//
// Positions are 0-based; cells outside the Term are skipped. Drawing writes blit rows, so the Term's cursor and colours
// stay as they were (unlike CraftOS, where drawing moves the cursor and changes the background colour).

import fs from 'fs';
import { ERR_INVALID_ARG_TYPE } from '/rom/lib/internal/errors';
import { validateInteger, validateNumber, validateObject, validateString } from '/rom/lib/internal/validators';

const HEX = '0123456789abcdef';

/** The blit digit of a color index: blit digit d is color index 15 - d (see TerminalEmulator). */
export function blitDigit(color: ColorIndex): string {
    validateInteger(color, 'color', 0, 15);
    return HEX.charAt(15 - color);
}

// ── Images ───────────────────────────────────────────────────────────────────────

export function parseNfp(text: string): PixelImage {
    validateString(text, 'text');
    let lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.map((line) => {
        let row: (ColorIndex | null)[] = [];
        for (let i = 0; i < line.length; i++) {
            let digit = HEX.indexOf(line.charAt(i).toLowerCase());
            row.push(digit < 0 ? null : (15 - digit) as ColorIndex);
        }
        return row;
    });
}

export function loadNfp(path: string): PixelImage {
    return parseNfp(fs.readFileSync(path, 'utf8'));
}

export function parseNft(text: string): TextImage {
    validateString(text, 'text');
    let rows: TextImage = [];
    let row: TextImageRow = { text: '', textColor: '', backgroundColor: '' };
    let fg = '0', bg = 'f';
    for (let i = 0; i < text.length; i++) {
        let ch = text.charAt(i);
        if (ch === '\x1F' && i + 1 < text.length) {
            fg = text.charAt(++i);
        } else if (ch === '\x1E' && i + 1 < text.length) {
            bg = text.charAt(++i);
        } else if (ch === '\n') {
            rows.push(row);
            row = { text: '', textColor: '', backgroundColor: '' };
            fg = '0';
            bg = 'f';
        } else if (ch !== '\r') {
            row.text += ch;
            row.textColor += fg;
            row.backgroundColor += bg;
        }
    }
    if (row.text !== '') rows.push(row);
    return rows;
}

export function loadNft(path: string): TextImage {
    return parseNft(fs.readFileSync(path, 'utf8'));
}

// ── Drawing ──────────────────────────────────────────────────────────────────────

function position(value: unknown, name: string): { x: number; y: number } {
    validateObject(value, name);
    let { x, y } = value as CursorPosition;
    validateNumber(x, `${name}.x`);
    validateNumber(y, `${name}.y`);
    return { x: Math.floor(x), y: Math.floor(y) };
}

function validateTerm(term: unknown): asserts term is Term {
    if (term === null || typeof term !== 'object' || typeof (term as Term).blit !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('term', 'Term', term);
    }
}

/**
 * Draw on a Term and put its cursor back: `draw` gets `run(x, y, text, fg, bg)`, which writes a blit run clipped to the
 * Term.
 */
function drawing(term: Term, draw: (run: (x: number, y: number, text: string, fg: string, bg: string) => void) => void): void {
    let { width, height } = term.getSize();
    let cursor = term.getCursorPos();
    try {
        draw((x, y, text, fg, bg) => {
            if (y < 0 || y >= height) return;
            let start = Math.max(0, -x), end = Math.min(text.length, width - x);
            if (start >= end) return;
            term.setCursorPos({ x: x + start, y });
            term.blit(text.slice(start, end), fg.slice(start, end), bg.slice(start, end));
        });
    } finally {
        term.setCursorPos(cursor);
    }
}

/** A run of `length` cells in one colour. */
function solid(color: ColorIndex, length: number): [string, string, string] {
    let digit = blitDigit(color);
    return [' '.repeat(length), digit.repeat(length), digit.repeat(length)];
}

export function drawPixel(term: Term, at: CursorPosition, color: ColorIndex): void {
    validateTerm(term);
    let p = position(at, 'at');
    let cell = solid(color, 1);
    drawing(term, (run) => run(p.x, p.y, ...cell));
}

export function drawLine(term: Term, from: CursorPosition, to: CursorPosition, color: ColorIndex): void {
    validateTerm(term);
    let a = position(from, 'from'), b = position(to, 'to');
    let cell = solid(color, 1);
    drawing(term, (run) => {
        // Bresenham, as paintutils.drawLine.
        let dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
        let sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
        let error = dx + dy;
        let x = a.x, y = a.y;
        while (true) {
            run(x, y, ...cell);
            if (x === b.x && y === b.y) break;
            let e2 = 2 * error;
            if (e2 >= dy) { error += dy; x += sx; }
            if (e2 <= dx) { error += dx; y += sy; }
        }
    });
}

function corners(from: CursorPosition, to: CursorPosition) {
    let a = position(from, 'from'), b = position(to, 'to');
    return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
}

export function drawBox(term: Term, from: CursorPosition, to: CursorPosition, color: ColorIndex): void {
    validateTerm(term);
    let { left, right, top, bottom } = corners(from, to);
    let row = solid(color, right - left + 1), cell = solid(color, 1);
    drawing(term, (run) => {
        run(left, top, ...row);
        for (let y = top + 1; y < bottom; y++) {
            run(left, y, ...cell);
            if (right !== left) run(right, y, ...cell);
        }
        if (bottom !== top) run(left, bottom, ...row);
    });
}

export function drawFilledBox(term: Term, from: CursorPosition, to: CursorPosition, color: ColorIndex): void {
    validateTerm(term);
    let { left, right, top, bottom } = corners(from, to);
    let row = solid(color, right - left + 1);
    drawing(term, (run) => {
        for (let y = top; y <= bottom; y++) run(left, y, ...row);
    });
}

export function drawImage(term: Term, image: PixelImage | TextImage, at: CursorPosition): void {
    validateTerm(term);
    if (!Array.isArray(image)) throw new ERR_INVALID_ARG_TYPE('image', 'Array', image);
    let p = position(at, 'at');
    drawing(term, (run) => {
        image.forEach((row, y) => {
            if (Array.isArray(row)) {
                // A pixel row: one run per stretch of opaque pixels.
                let x = 0;
                while (x < row.length) {
                    if (row[x] === null || row[x] === undefined) { x++; continue; }
                    let digits = '';
                    let start = x;
                    while (x < row.length && row[x] !== null && row[x] !== undefined) digits += blitDigit(row[x] as ColorIndex), x++;
                    run(p.x + start, p.y + y, ' '.repeat(digits.length), digits, digits);
                }
            } else if (row !== null && typeof row === 'object') {
                run(p.x, p.y + y, row.text, row.textColor, row.backgroundColor);
            }
        });
    });
}

// The exports implement the module's public type (types/image.d.ts).
type Exports<T extends ImageModule> = T;
type _Exports = Exports<typeof import('/rom/lib/image')>;
