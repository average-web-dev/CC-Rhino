// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `term` — Term, a drawing and input API over a TTY (ROM module /rom/lib/term).

/**
 * A drawing and input API over a TTY: it writes ANSI escape sequences into the TTY (and reads from it), so it works
 * on any TTY (a console of the screen, a monitor, a virtual TTY). Colours apply to what is written through this Term
 * only; text wraps at the Term's width; the Term tracks its cursor itself.
 */
interface Term {
    /** The TTY this Term draws on. */
    readonly tty: TTY;
    /** The size text wraps at: the TTY's, unless set with setSize. */
    getSize(): TermSize;
    /** Wrap text at `width` and treat `height` as the last row. */
    setSize(width: number, height: number): void;
    isColor(): boolean;
    getCursorPos(): CursorPosition;
    setCursorPos(pos: CursorPosition): void;
    getCursorBlink(): boolean;
    setCursorBlink(blink: boolean): void;
    /** The text colour (a CC colour: a power of two, as `colors`). */
    getTextColor(): number;
    setTextColor(colour: number): void;
    getBackgroundColor(): number;
    setBackgroundColor(colour: number): void;
    /** Write text at the cursor in this Term's colours, wrapping at its width; `\n` starts a new row. */
    write(text: string): void;
    /** write(text) followed by a new row. */
    print(text?: string): void;
    /** Write `text` with one colour per character (blit digits `0` … `f`), without wrapping. */
    blit(text: string, textColour: string, backgroundColour: string): void;
    /** Clear the whole TTY in the background colour (the cursor stays). */
    clear(): void;
    /** Clear the cursor's row in the background colour (the cursor stays). */
    clearLine(): void;
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): void;
    /** Wait for a key (a Node key object), or `undefined` at end of input. Mouse reports are ignored. */
    readKey(): Key | undefined;
    /** Wait for one character of input, or `undefined` at end of input. */
    readChar(): string | undefined;
    /** Wait for a line of input (without its line ending), or `undefined` at end of input. */
    readLine(): string | undefined;
}

interface TermConstructor {
    /** A Term over `tty` (default: the program's TTY, the one behind process.stdout). */
    new (tty?: TTY): Term;
    readonly prototype: Term;
}

interface TermModule {
    Term: TermConstructor;
}

declare function require(id: "term"): TermModule;
declare module "term" { const term: TermModule; export = term; }
