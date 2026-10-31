// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/csi.ts — the escape sequences the ROM writes to a TTY (like Node's CSI in
// lib/internal/readline/utils.js). Public as `tty.CSI`; util and console use it from here, so they do not load tty.

import { validateInteger } from '/rom/lib/internal/validators';

const ESC = '\x1b';

/**
 * The escape sequences a TTY understands, so programs (and the ROM) need not spell them out: cursor movement as
 * readline and Node's tty.WriteStream write it, plus showing the cursor, clearing, colours, blit and mouse reports.
 */
export const CSI = {
    /** Show the (blinking) cursor. */
    showCursor: `${ESC}[?25h`,
    /** Hide the cursor. */
    hideCursor: `${ESC}[?25l`,
    /** Clear the whole screen (the cursor stays). */
    clearScreen: `${ESC}[2J`,
    /** Move the cursor to the top left. */
    home: `${ESC}[H`,
    /** Back to the default colours. */
    reset: `${ESC}[0m`,
    /**
     * Select graphic rendition: SGR parameters such as `1` (bold), `31` (red text) or `39` (default text colour), as
     * util.styleText writes them.
     */
    sgr(...params: number[]): string {
        return `${ESC}[${params.join(';')}m`;
    },
    /**
     * Select colours by their index (0–15, as on a Linux terminal: 0 black … 7 white, 8–15 bright): text, and
     * optionally background.
     */
    color(fg: number, bg?: number): string {
        validateInteger(fg, 'fg', 0, 15);
        let out = `${ESC}[38;5;${fg}`;
        if (bg !== undefined) {
            validateInteger(bg, 'bg', 0, 15);
            out += `;48;5;${bg}`;
        }
        return out + 'm';
    },
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): string {
        n = Math.trunc(n);
        return n > 0 ? `${ESC}[${n}S` : n < 0 ? `${ESC}[${-n}T` : '';
    },
    /** Write `text` with one text and one background colour (blit digits) per character, without wrapping. */
    blit(text: string, fg: string, bg: string): string {
        return `${ESC}Pcc-blit;${fg};${bg};${text}${ESC}\\`;
    },
    /** Ask for mouse reports in stdin (SGR encoding, presses, releases and drags), or stop them. */
    mouse(on: boolean): string {
        return on ? `${ESC}[?1002;1006h` : `${ESC}[?1002;1006l`;
    },
    /**
     * Ask for the kitty keyboard protocol with these flags (KeyboardFlag, combined with `|`); the terminal keeps a
     * stack, so popKeyboardFlags() restores what was asked for before.
     */
    pushKeyboardFlags(flags: number): string {
        validateInteger(flags, 'flags', 0, 31);
        return `${ESC}[>${flags}u`;
    },
    /** Undo the last `n` (default 1) pushKeyboardFlags. */
    popKeyboardFlags(n = 1): string {
        validateInteger(n, 'n', 1);
        return `${ESC}[<${n}u`;
    },
    cursorTo(x: number, y?: number): string {
        return typeof y !== 'number' ? `${ESC}[${x + 1}G` : `${ESC}[${y + 1};${x + 1}H`;
    },
    moveCursor(dx: number, dy: number): string {
        let data = '';
        if (dx < 0) data += `${ESC}[${-dx}D`; else if (dx > 0) data += `${ESC}[${dx}C`;
        if (dy < 0) data += `${ESC}[${-dy}A`; else if (dy > 0) data += `${ESC}[${dy}B`;
        return data;
    },
    clearLine(dir: number): string {
        return dir < 0 ? `${ESC}[1K` : dir > 0 ? `${ESC}[0K` : `${ESC}[2K`;
    },
    clearScreenDown: `${ESC}[0J`,
};
