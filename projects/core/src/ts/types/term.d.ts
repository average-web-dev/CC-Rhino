// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `term` — Term, a drawing and input API over a TTY (ROM module /rom/lib/term).

/** The size of a Term in characters. */
interface TermSize {
    width: number;
    height: number;
}

/**
 * A drawing and input API over a TTY: it writes ANSI escape sequences into the TTY (and reads from it), so it works
 * on any TTY (a console of the screen, a monitor, a virtual TTY). Colors apply to what is written through this Term
 * only; write() cuts text off at the Term's width, print() wraps; the Term tracks its cursor itself.
 */
interface Term {
    /** The TTY this Term draws on, if it was given one (otherwise it uses process.stdin / process.stdout). */
    readonly tty: TTY | undefined;
    /** The size print() wraps and write() cuts off at: the TTY's, unless set with setSize. */
    getSize(): TermSize;
    /** Wrap text at `width` and treat `height` as the last row. */
    setSize(width: number, height: number): void;
    isColor(): boolean;
    getCursorPos(): CursorPosition;
    setCursorPos(pos: CursorPosition): void;
    getCursorBlink(): boolean;
    setCursorBlink(blink: boolean): void;
    getTextColor(): ColorName;
    setTextColor(color: ColorName): void;
    getBackgroundColor(): ColorName;
    setBackgroundColor(color: ColorName): void;
    /**
     * Write text at the cursor in this Term's colors, cut off at the right edge (never wraps, so drawing on the last row
     * does not scroll); `\n` starts a new row. The cursor moves behind the text, also past the edge.
     */
    write(text: string): void;
    /** Write text and start a new row, wrapping at the Term's width (scrolling at the bottom), like console.log. */
    print(text?: string): void;
    /** Write `text` with one color per character (blit digits `0` … `f`), without wrapping. */
    blit(text: string, textColor: string, backgroundColor: string): void;
    /** Clear the whole TTY in the background color (the cursor stays). */
    clear(): void;
    /** Clear the cursor's row in the background color (the cursor stays). */
    clearLine(): void;
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): void;
    /**
     * Wait for the next input: a keyboard event ('keydown' / 'keyup') or (after `CSI.mouse(true)`) a mouse event, or
     * `undefined` at end of input. Compare `type` against InputType, `code` against Key, `action` against MouseAction,
     * `button` against MouseButton.
     */
    readInput(): TtyInput | undefined;
    /** Wait for a key press (a 'keydown' event), or `undefined` at end of input. Releases and mouse are skipped. */
    readKey(): TtyKeyInput | undefined;
    /** Wait for one character of input, or `undefined` at end of input. */
    readChar(): string | undefined;
    /** Wait for a line of input (without its line ending), or `undefined` at end of input. */
    readLine(): string | undefined;
}

/**
 * The 16 colors by name, with their index on the TTY (as CSI.color takes it). The TTY shows each index as one CC color;
 * changing what an index shows (the palette) is #54.
 */
interface ColorIndexMap {
    readonly black: 0; readonly red: 1; readonly green: 2; readonly brown: 3; readonly blue: 4; readonly purple: 5;
    readonly cyan: 6; readonly lightGray: 7; readonly lightGrey: 7; readonly gray: 8; readonly grey: 8;
    readonly pink: 9; readonly lime: 10; readonly yellow: 11; readonly lightBlue: 12; readonly magenta: 13;
    readonly orange: 14; readonly white: 15;
}

/** A color's name (a key of ColorIndex), as Term's color methods take it. */
type ColorName = keyof ColorIndexMap;

interface TermConstructor {
    /** A Term over `tty`, or (without one) over the calling program's process.stdin / process.stdout. */
    new (tty?: TTY): Term;
    readonly prototype: Term;
}

interface TermModule {
    Term: TermConstructor;
    ColorIndex: ColorIndexMap;
    /** The physical keys: compare `event.code` against these. */
    Key: TtyKeyCodes;
    InputType: TtyInputTypes;
    MouseAction: TtyMouseActions;
    MouseButton: TtyMouseButtons;
}

declare function require(id: "term"): TermModule;
declare module "term" { const term: TermModule; export = term; }
