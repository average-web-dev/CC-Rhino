// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The image module (#3): .nfp / .nft parsing and drawing pixels, lines, boxes and images on a Term. Run by
// StdioLibraryTest.

import * as prelude from './prelude';
import fs from 'fs';
import image from 'image';
import { TTY, CSI } from 'tty';
import { Term, ColorIndex } from 'term';

const eq = prelude.eq, throws = prelude.throws;

function same(actual: unknown, expected: unknown, message?: string): void {
    eq(JSON.stringify(actual), JSON.stringify(expected), message);
}

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

eq(image.blitDigit(ColorIndex.WHITE), '0');
eq(image.blitDigit(ColorIndex.BLACK), 'f');
eq(image.blitDigit(ColorIndex.RED), 'e');

same(image.parseNfp('0e\n f\n'), [[ColorIndex.WHITE, ColorIndex.RED], [null, ColorIndex.BLACK]], 'spaces are transparent');
same(image.parseNfp('E\r\n'), [[ColorIndex.RED]], 'upper case, CRLF');

same(image.parseNft('ab\x1Fe\x1E5c\nd'), [
    { text: 'abc', textColor: '00e', backgroundColor: 'ff5' },
    { text: 'd', textColor: '0', backgroundColor: 'f' },
], 'colour bytes, and every line starts white on black');

fs.writeFileSync('/pic.nfp', 'e e\n');
same(image.loadNfp('/pic.nfp'), [[ColorIndex.RED, null, ColorIndex.RED]]);
fs.writeFileSync('/pic.nft', '\x1Ebhi\n');
same(image.loadNft('/pic.nft'), [{ text: 'hi', textColor: '00', backgroundColor: 'bb' }]);

// ── Drawing: blit runs at the right places, clipped, the cursor put back ─────────────────────────────────────────────

const tty = new TTY(6, 3);
const term = new Term(tty);
term.setCursorPos({ x: 1, y: 1 });
tty.readOutput();
const back = CSI.cursorTo(1, 1);
const at = (x: number, y: number) => CSI.cursorTo(x, y);
const red = (n: number) => CSI.blit(' '.repeat(n), 'e'.repeat(n), 'e'.repeat(n));

image.drawPixel(term, { x: 2, y: 0 }, ColorIndex.RED);
eq(tty.readOutput(), at(2, 0) + red(1) + back);
same(term.getCursorPos(), { x: 1, y: 1 }, 'the cursor is put back');

image.drawFilledBox(term, { x: 4, y: 2 }, { x: 3, y: 1 }, ColorIndex.RED);
eq(tty.readOutput(), at(3, 1) + red(2) + at(3, 2) + red(2) + back, 'corners in any order');

image.drawBox(term, { x: 0, y: 0 }, { x: 2, y: 2 }, ColorIndex.RED);
eq(tty.readOutput(), at(0, 0) + red(3) + at(0, 1) + red(1) + at(2, 1) + red(1) + at(0, 2) + red(3) + back);

image.drawLine(term, { x: 0, y: 0 }, { x: 2, y: 1 }, ColorIndex.RED);
eq(tty.readOutput(), at(0, 0) + red(1) + at(1, 1) + red(1) + at(2, 1) + red(1) + back, 'Bresenham');

image.drawFilledBox(term, { x: -2, y: -1 }, { x: 10, y: 0 }, ColorIndex.RED);
eq(tty.readOutput(), at(0, 0) + red(6) + back, 'clipped to the Term');

image.drawImage(term, image.parseNfp('e ee\n'), { x: 1, y: 2 });
eq(tty.readOutput(), at(1, 2) + red(1) + at(3, 2) + red(2) + back, 'transparent pixels are skipped');

image.drawImage(term, image.parseNft('\x1F1ab'), { x: 4, y: 0 });
eq(tty.readOutput(), at(4, 0) + CSI.blit('ab', '11', 'ff') + back, 'text images as blit rows');

throws(() => image.drawPixel({} as any, { x: 0, y: 0 }, ColorIndex.RED), 'ERR_INVALID_ARG_TYPE');
throws(() => image.drawPixel(term, { x: 'a' } as any, ColorIndex.RED), 'ERR_INVALID_ARG_TYPE');
throws(() => image.drawPixel(term, { x: 0, y: 0 }, 16 as any), 'ERR_OUT_OF_RANGE');
