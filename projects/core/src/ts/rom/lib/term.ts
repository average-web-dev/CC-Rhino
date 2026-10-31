// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/term.ts — Term: a convenient drawing and input API over a TTY.
//
//   import { Term } from 'term';
//   const term = new Term();                   // the program's own: process.stdout / process.stdin
//   const mon = new Term(TTY.from(monitor.getTty()));
//   term.setTextColor(16384); term.write('red'); term.setCursorPos({ x: 0, y: 2 }); term.blit('ab', '0e', 'ff');
//
// A Term only writes ANSI escape sequences into its TTY (and reads from it): whatever shows the TTY (a console of the
// screen, a monitor) draws them, and the same program works on a virtual TTY. So:
// - Colours set with setTextColor / setBackgroundColor apply to what is written through this Term only: each write
//   selects its colours and resets them afterwards (other output, e.g. console.log, keeps the default colours).
// - The Term keeps track of its cursor itself (it knows what it wrote); others writing to the same TTY move the real
//   cursor without it noticing, so setCursorPos before drawing is the safe pattern.
// - write() cuts text off at the Term's width (the TTY's, unless set with setSize), so drawing never scrolls; print()
//   wraps at the width and scrolls at the bottom, like console.log.
// - Input reads the TTY's stdin: readInput returns keys and mouse events (after CSI.mouse(true)), readKey / readChar /
//   readLine skip mouse reports. The mouse is also available as events (mouse_click, monitor_touch).

import { TTY, CSI, colourIndex } from '/rom/lib/tty';
import { decodeInput, stripMouse, KeyName, InputType, MouseAction, MouseButton } from '/rom/lib/internal/keys';

/** The names of the keys readKey() returns (`key.name`), and the constants for readInput()'s results. */
export { KeyName, InputType, MouseAction, MouseButton };

const WHITE = 1;
const BLACK = 32768;

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
    #fg = WHITE;
    #bg = BLACK;
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
        if (!(width >= 1) || !(height >= 1)) throw new RangeError('size must be positive');
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

    // ── Colours ──────────────────────────────────────────────────────────────────

    getTextColor(): number { return this.#fg; }

    setTextColor(colour: number): void {
        colourIndex(colour);
        this.#fg = colour;
    }

    getBackgroundColor(): number { return this.#bg; }

    setBackgroundColor(colour: number): void {
        colourIndex(colour);
        this.#bg = colour;
    }

    /** The SGR sequence selecting this Term's colours ('' for the defaults). */
    #colours(): string {
        if (this.#fg === WHITE && this.#bg === BLACK) return '';
        return CSI.color(this.#fg, this.#bg);
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
     * Write text at the cursor in this Term's colours, cut off at the right edge (it never wraps, so drawing on the last
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
        let colours = this.#colours();
        if (colours !== '') out.push(colours);
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
        if (colours !== '') out.push(CSI.reset);
        this.#out(out.join(''));
    }

    /**
     * Write `text` at the cursor with one colour per character: `textColour` and `backgroundColour` are strings of
     * blit digits (`0` white … `f` black) as long as `text`. No wrapping; the cursor moves behind the text.
     */
    blit(text: string, textColour: string, backgroundColour: string): void {
        if (textColour.length !== text.length || backgroundColour.length !== text.length) {
            throw new RangeError('arguments must be the same length');
        }
        if (!/^[0-9a-fA-F]*$/.test(textColour) || !/^[0-9a-fA-F]*$/.test(backgroundColour)) {
            throw new RangeError('colours must be blit digits (0-9, a-f)');
        }
        this.#out(CSI.blit(text, textColour, backgroundColour));
        this.#x += text.length;
    }

    /** Clear the whole TTY in the background colour (the cursor stays). */
    clear(): void {
        this.#painted(CSI.clearScreen);
    }

    /** Clear the cursor's row in the background colour (the cursor stays). */
    clearLine(): void {
        this.#painted(CSI.clearLine(0));
    }

    /** Write a sequence in this Term's colours (clearing uses the background colour). */
    #painted(sequence: string): void {
        let colours = this.#colours();
        this.#out(colours === '' ? sequence : colours + sequence + CSI.reset);
    }

    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): void {
        let sequence = CSI.scroll(n);
        if (sequence !== '') this.#out(sequence);
    }

    // ── Input ────────────────────────────────────────────────────────────────────

    /** Read more input from the TTY (blocks); it keeps mouse reports for readInput(). */
    #fill(): boolean {
        let data = this.#input.readSync();
        if (data === undefined) return false;
        this.#text += data;
        return true;
    }

    /** Drop the mouse reports from the buffered input (for the readers of text). */
    #textOnly(): void {
        this.#text = stripMouse(this.#text);
    }

    /**
     * Wait for the next input: a key (`{ type: InputType.KEY, sequence, name, ctrl, meta, shift }`) or, once mouse
     * reports are asked for (`CSI.mouse(true)`), a mouse event (`{ type: InputType.MOUSE, action, button, direction,
     * x, y, ctrl, meta, shift }`, coordinates from 0); `undefined` at end of input. Use raw mode for single keys.
     */
    readInput(): TtyInput | undefined {
        while (this.#text.length === 0) {
            if (!this.#fill()) return undefined;
        }
        let input = decodeInput(this.#text)[0];
        this.#text = this.#text.slice(Math.max(1, input.sequence.length));
        return input;
    }

    /**
     * Wait for a key and return it as a Node key object (`{ sequence, name, ctrl, meta, shift }`), or `undefined` at
     * end of input. Mouse reports are skipped. Use raw mode (`process.stdin.setRawMode(true)`) to get every key as it
     * is pressed.
     */
    readKey(): Key | undefined {
        while (true) {
            let input = this.readInput();
            if (input === undefined) return undefined;
            if (input.type === InputType.KEY) {
                let { sequence, name, ctrl, meta, shift } = input;
                return { sequence, name, ctrl, meta, shift };
            }
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
