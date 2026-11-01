// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/term.ts — Term: a convenient drawing and input API over a TTY.
//
//   import { Term } from 'term';
//   const term = new Term();                   // the program's own: process.stdout / process.stdin
//   const mon = new Term(TTY.from(monitor.getTty()));
//   term.setTextColor(ColorIndex.RED); term.write('red'); term.setCursorPos({ x: 0, y: 2 }); term.blit('ab', '0e', 'ff');
//   term.setPaletteColor(ColorIndex.BLUE, Color.from('#87ceeb'));   // index 4 now shows sky blue on this TTY
//
// A Term only writes ANSI escape sequences into its TTY (and reads from it): whatever shows the TTY (a console of the
// screen, a monitor) draws them, and the same program works on a virtual TTY. So:
// - Colors are the TTY's color indices 0–15 (ColorIndex names them after the default palette: ColorIndex.RED is 1).
//   The colors set with setTextColor / setBackgroundColor apply to what is written through this Term only: each write
//   selects its colors and resets them afterwards (other output, e.g. console.log, keeps the default colors).
// - What an index shows is the TTY's palette: setPaletteColor changes it for everything on the TTY (also what is
//   already on screen), until resetPalette; it stays after the program ends, as on Linux. getPaletteColor reads it
//   from the device.
// - The Term keeps track of its cursor itself (it knows what it wrote); others writing to the same TTY move the real
//   cursor without it noticing, so setCursorPos before drawing is the safe pattern.
// - write() cuts text off at the Term's width (the TTY's, unless set with setSize), so drawing never scrolls; print()
//   wraps at the width and scrolls at the bottom, like console.log.
// - Input reads the TTY's stdin: readInput returns keyboard events (like the browser's: `type` 'keydown' / 'keyup',
//   `key`, `code` — compare against Key —, `repeat`, `ctrlKey` …), mouse events (after CSI.mouse(true); until then the
//   mouse belongs to the terminal) and pastes (after CSI.bracketedPaste(true); otherwise pasted text comes as typed);
//   readKey returns the next key press; readChar / readLine return text (keys as a terminal traditionally sends them,
//   pasted text as it is) and skip mouse reports. In raw mode the terminal reports releases, repeats, the keypad and
//   modifier keys too, unless the stream's keyboard protocol is 'legacy' (stdin.setKeyboardProtocol). Monitors also
//   fire monitor_touch.

import { TTY, CSI } from '/rom/lib/tty';
import { decodeFirst, stripMouse, toLegacy, Key, InputType, MouseAction, MouseButton } from '/rom/lib/internal/keys';
import { Color } from '/rom/lib/color';
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from '/rom/lib/internal/errors';
import { validateInteger, validateNumber, validateString } from '/rom/lib/internal/validators';

/** The physical keys (`event.code`), and the constants for readInput()'s results. */
export { Key, InputType, MouseAction, MouseButton };

/**
 * The 16 color indices of a TTY (as CSI.color and setTextColor take them), named after the CC color each shows by
 * default; setPaletteColor changes what an index shows.
 */
export const ColorIndex = Object.freeze({
    BLACK: 0, RED: 1, GREEN: 2, BROWN: 3, BLUE: 4, PURPLE: 5, CYAN: 6, LIGHT_GRAY: 7, LIGHT_GREY: 7,
    GRAY: 8, GREY: 8, PINK: 9, LIME: 10, YELLOW: 11, LIGHT_BLUE: 12, MAGENTA: 13, ORANGE: 14, WHITE: 15,
} as const);

/** A color index, 0–15 (one of the ColorIndex values): the type of Term's color methods, like a numeric enum. */
export type ColorIndex = typeof ColorIndex[keyof typeof ColorIndex];

/** A position on a terminal, starting at 0. */
export interface CursorPosition { x: number; y: number; }
/** The size of a terminal in characters. */
export interface TermSize { width: number; height: number; }

export class Term {
    readonly #tty: TTY | undefined;
    readonly #input: TtyStdin;
    readonly #output: TtyWriteStream;
    #x = 0;
    #y = 0;
    #size: TermSize | null = null;
    #fg: ColorIndex = ColorIndex.WHITE;
    #bg: ColorIndex = ColorIndex.BLACK;
    #blink = false;
    /** Input read from the TTY but not consumed yet. */
    #text = '';

    /** A Term over `tty`, or (without one) over the calling program's process.stdin / process.stdout. */
    constructor(tty?: TTY) {
        this.#tty = tty;
        this.#input = (tty?.stdin ?? process.stdin) as TtyStdin;
        this.#output = tty?.stdout ?? process.stdout;
    }

    /** The TTY this Term draws on, if it was given one. */
    get tty(): TTY | undefined { return this.#tty; }

    // ── Size ─────────────────────────────────────────────────────────────────────

    /** The size print() wraps and write() cuts off at: the TTY's, unless set with setSize. */
    getSize(): TermSize {
        return this.#size ?? { width: this.#output.columns, height: this.#output.rows };
    }

    /** Wrap text at `width` and treat `height` as the last row (e.g. to draw into part of the TTY). */
    setSize(width: number, height: number): void {
        validateNumber(width, 'width', 1);
        validateNumber(height, 'height', 1);
        this.#size = { width: Math.floor(width), height: Math.floor(height) };
    }

    isColor(): boolean { return this.#output.hasColors(16); }

    // ── Cursor ───────────────────────────────────────────────────────────────────

    getCursorPos(): CursorPosition { return { x: this.#x, y: this.#y }; }

    setCursorPos(pos: CursorPosition): void {
        this.#x = Math.floor(pos.x);
        this.#y = Math.floor(pos.y);
        this.#out(CSI.cursorTo(this.#x, this.#y));
    }

    getCursorBlink(): boolean { return this.#blink; }

    setCursorBlink(blink: boolean): void {
        this.#blink = !!blink;
        this.#out(this.#blink ? CSI.showCursor : CSI.hideCursor);
    }

    // ── Colors ───────────────────────────────────────────────────────────────────

    getTextColor(): ColorIndex { return this.#fg; }

    /** The color index (0–15, see ColorIndex) text is written in. */
    setTextColor(index: ColorIndex): void {
        validateInteger(index, 'index', 0, 15);
        this.#fg = index;
    }

    getBackgroundColor(): ColorIndex { return this.#bg; }

    /** The color index (0–15, see ColorIndex) behind the text. */
    setBackgroundColor(index: ColorIndex): void {
        validateInteger(index, 'index', 0, 15);
        this.#bg = index;
    }

    /** The SGR sequence selecting this Term's colors ('' for the defaults). */
    #colors(): string {
        if (this.#fg === ColorIndex.WHITE && this.#bg === ColorIndex.BLACK) return '';
        return CSI.color(this.#fg, this.#bg);
    }

    // ── Palette ──────────────────────────────────────────────────────────────────

    /** Let color `index` (0–15) show `color` on the whole TTY (a translucent color is taken over black). */
    setPaletteColor(index: ColorIndex, color: Color): void {
        this.#out(CSI.setPaletteColor(index, color));
    }

    /** The color index `index` (0–15) shows on the device, or undefined on a virtual TTY. */
    getPaletteColor(index: ColorIndex): Color | undefined {
        let color = this.#output.getPaletteColor(index);
        return color === undefined ? undefined : Color.from(color);
    }

    /** Let color `index` (or, without one, every color) show its default again. */
    resetPalette(index?: ColorIndex): void {
        this.#out(CSI.resetPalette(index));
    }

    // ── Drawing ──────────────────────────────────────────────────────────────────

    #out(data: string): void {
        this.#output.write(data);
    }

    /** Move to the start of the next row (the TTY scrolls at its bottom). */
    #newLine(out: string[]): void {
        out.push('\r\n');
        this.#x = 0;
        if (this.#y < this.getSize().height - 1) this.#y++;
    }

    /**
     * Write text at the cursor in this Term's colors, cut off at the right edge (it never wraps, so drawing on the last
     * row does not scroll); `\n` starts a new row. The cursor moves behind the text, also past the edge.
     */
    write(text: string): void {
        this.#emit(String(text), false);
    }

    /** Write text and start a new row, wrapping at the Term's width (scrolling at the bottom), like console.log. */
    print(text = ''): void {
        this.#emit(String(text) + '\n', true);
    }

    #emit(text: string, wrap: boolean): void {
        let width = this.getSize().width;
        let out: string[] = [];
        let colors = this.#colors();
        if (colors !== '') out.push(colors);
        let run = '';
        let flush = () => { if (run !== '') { out.push(run); run = ''; } };
        for (let i = 0; i < text.length; i++) {
            let ch = text.charAt(i);
            if (ch === '\n') { flush(); this.#newLine(out); continue; }
            if (ch === '\r') { flush(); out.push('\r'); this.#x = 0; continue; }
            if (this.#x >= width && wrap) { flush(); this.#newLine(out); }
            if (ch === '\t') {
                let spaces = 8 - (this.#x % 8);
                run += ' '.repeat(Math.max(0, Math.min(spaces, width - this.#x)));
                this.#x += wrap ? Math.min(spaces, width - this.#x) : spaces;
                continue;
            }
            let code = ch.charCodeAt(0);
            if (code < 0x20 || code === 0x7f) continue; // other control characters would confuse the emulator
            if (this.#x < width) run += ch;
            this.#x++;
        }
        flush();
        if (colors !== '') out.push(CSI.reset);
        this.#out(out.join(''));
    }

    /**
     * Write `text` at the cursor with one color per character: `textColor` and `backgroundColor` are strings of
     * blit digits (`0` white … `f` black) as long as `text`. No wrapping; the cursor moves behind the text.
     */
    blit(text: string, textColor: string, backgroundColor: string): void {
        validateString(text, 'text');
        for (let [name, colors] of [['textColor', textColor], ['backgroundColor', backgroundColor]] as const) {
            validateString(colors, name);
            if (colors.length !== text.length) {
                throw new ERR_INVALID_ARG_VALUE(name, colors, 'must be as long as the text');
            }
            if (!/^[0-9a-fA-F]*$/.test(colors)) {
                throw new ERR_INVALID_ARG_VALUE(name, colors, 'must be blit digits (0-9, a-f)');
            }
        }
        this.#out(CSI.blit(text, textColor, backgroundColor));
        this.#x += text.length;
    }

    /** Clear the whole TTY in the background color (the cursor stays). */
    clear(): void {
        this.#painted(CSI.clearScreen);
    }

    /** Clear the cursor's row in the background color (the cursor stays). */
    clearLine(): void {
        this.#painted(CSI.clearLine(0));
    }

    /** Write a sequence in this Term's colors (clearing uses the background color). */
    #painted(sequence: string): void {
        let colors = this.#colors();
        this.#out(colors === '' ? sequence : colors + sequence + CSI.reset);
    }

    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): void {
        let sequence = CSI.scroll(n);
        if (sequence !== '') this.#out(sequence);
    }

    // ── Text layout ──────────────────────────────────────────────────────────────

    /**
     * Print lists of words in columns as wide as the longest word (like `ls`; CraftOS's textutils.tabulate): each list
     * starts on a new row; a ColorIndex in between switches the text color for the lists after it. The Term's text
     * color is restored afterwards.
     */
    tabulate(...groups: (readonly string[] | ColorIndex)[]): void {
        let width = this.getSize().width;
        let longest = 0;
        for (let group of groups) {
            if (typeof group === 'number') {
                validateInteger(group, 'color', 0, 15);
                continue;
            }
            if (!Array.isArray(group)) throw new ERR_INVALID_ARG_TYPE('groups', ['Array', 'number'], group);
            for (let item of group) {
                validateString(item, 'item');
                longest = Math.max(longest, item.length);
            }
        }
        // Columns at least an eighth of the width wide, one space between them.
        let column = Math.max(width / 8, longest + 1);
        let columns = Math.max(1, Math.floor(width / column));
        let saved = this.#fg;
        try {
            for (let group of groups) {
                if (typeof group === 'number') {
                    this.#fg = group;
                    continue;
                }
                for (let start = 0; start < group.length; start += columns) {
                    let line = '';
                    for (let i = 0; i < columns && start + i < group.length; i++) {
                        line = line.padEnd(Math.floor(i * column), ' ') + group[start + i];
                    }
                    this.write(line + '\n');
                }
            }
        } finally {
            this.#fg = saved;
        }
    }

    /**
     * Print text a screen at a time (CraftOS's textutils.pagedPrint): after each screen full it asks to "Press any key
     * to continue" and waits for a key (in raw mode for the moment). Returns false if `q` was pressed (the rest is not
     * printed) or the input ended.
     */
    page(text: string): boolean {
        validateString(text, 'text');
        let { width, height } = this.getSize();
        let rows = 0;
        for (let line of text.split('\n')) {
            let chunks: string[] = [];
            for (let i = 0; i < line.length; i += width) chunks.push(line.slice(i, i + width));
            if (chunks.length === 0) chunks.push('');
            for (let chunk of chunks) {
                if (rows >= height - 1) {
                    if (!this.#waitForMore()) return false;
                    rows = 0;
                }
                this.print(chunk);
                rows++;
            }
        }
        return true;
    }

    /** The pager's prompt: true to go on, false for `q` or the end of input. */
    #waitForMore(): boolean {
        let saved = this.#fg;
        this.#fg = ColorIndex.LIGHT_GRAY;
        this.write('Press any key to continue');
        this.#fg = saved;
        let raw = this.#input.isRaw;
        if (!raw) this.#input.setRawMode(true);
        let key: TtyKeyInput | undefined;
        try {
            key = this.readKey();
        } finally {
            if (!raw) this.#input.setRawMode(false);
        }
        this.write('\r');
        this.clearLine();
        return key !== undefined && key.key !== 'q' && key.key !== 'Q';
    }

    // ── Input ────────────────────────────────────────────────────────────────────

    /** Read more input from the TTY (blocks); it keeps mouse reports for readInput(). */
    #fill(): boolean {
        let data = this.#input.readRawSync();
        if (data === undefined) return false;
        this.#text += data;
        return true;
    }

    /**
     * Drop the mouse reports, key releases and paste brackets from the buffered input, keys as text (for the readers
     * of text).
     */
    #textOnly(): void {
        this.#text = toLegacy(stripMouse(this.#text));
    }

    /**
     * Wait for the next input: a keyboard event (`{ type: 'keydown' | 'keyup', key, code, repeat, ctrlKey, shiftKey,
     * altKey, metaKey, sequence }`) or, once mouse reports are asked for (`CSI.mouse(true)`), a mouse event (`{ type:
     * 'mouse', action, button, direction, x, y, ctrlKey, … }`, coordinates from 0) or, once bracketed paste is asked for
     * (`CSI.bracketedPaste(true)`), a paste (`{ type: 'paste', text }`); `undefined` at end of input. Use raw mode for
     * single keys.
     */
    readInput(): TtyInput | undefined {
        while (this.#text.length === 0) {
            if (!this.#fill()) return undefined;
        }
        let [input, length] = decodeFirst(this.#text)!;
        this.#text = this.#text.slice(length);
        return input;
    }

    /**
     * Wait for a key press (a 'keydown' event: `key`, `code`, `repeat`, `ctrlKey` …), or `undefined` at end of input.
     * Releases and mouse reports are skipped. Use raw mode (`process.stdin.setRawMode(true)`) to get every key as it
     * is pressed.
     */
    readKey(): TtyKeyInput | undefined {
        while (true) {
            let input = this.readInput();
            if (input === undefined) return undefined;
            if (input.type === InputType.KEY_DOWN) return input;
        }
    }

    /** Wait for one character of input, or `undefined` at end of input. Mouse reports are skipped. */
    readChar(): string | undefined {
        this.#textOnly();
        while (this.#text.length === 0) {
            if (!this.#fill()) return undefined;
            this.#textOnly();
        }
        let ch = this.#text.charAt(0);
        this.#text = this.#text.slice(1);
        return ch;
    }

    /** Wait for a line of input (without its line ending), or `undefined` at end of input. Mouse reports are skipped. */
    readLine(): string | undefined {
        while (true) {
            this.#textOnly();
            let match = /\r?\n|\r/.exec(this.#text);
            if (match !== null) {
                let line = this.#text.slice(0, match.index);
                this.#text = this.#text.slice(match.index + match[0].length);
                return line;
            }
            if (!this.#fill()) {
                if (this.#text === '') return undefined;
                let line = this.#text;
                this.#text = '';
                return line;
            }
        }
    }
}
