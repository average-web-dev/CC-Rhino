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
    getTextColor(): ColorIndex;
    /** The color index (0–15, see ColorIndex) text is written in. */
    setTextColor(index: ColorIndex): void;
    getBackgroundColor(): ColorIndex;
    /** The color index (0–15, see ColorIndex) behind the text. */
    setBackgroundColor(index: ColorIndex): void;
    /**
     * Let color `index` (0–15) show `color` on the whole TTY, also what is already on screen, until resetPalette() (it
     * stays after the program ends, as on Linux). A translucent color is taken over black: #ff0000 with alpha 0.5 is
     * #7f0000.
     */
    setPaletteColor(index: ColorIndex, color: Color): void;
    /** The color index `index` (0–15) shows on the device, or `undefined` on a virtual TTY. */
    getPaletteColor(index: ColorIndex): Color | undefined;
    /** Let color `index` (or, without one, every color) show its default again. */
    resetPalette(index?: ColorIndex): void;
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
     * Print lists of words in columns as wide as the longest word (like `ls`): each list starts on a new row; a
     * ColorIndex in between switches the text color for the lists after it (restored afterwards).
     */
    tabulate(...groups: (readonly string[] | ColorIndex)[]): void;
    /**
     * Print text a screen at a time, asking to "Press any key to continue" after each; false if `q` was pressed or the
     * input ended.
     */
    page(text: string): boolean;
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
 * The 16 color indices of a TTY (as CSI.color and Term.setTextColor take them), named after the CC color each shows by
 * default; Term.setPaletteColor changes what an index shows.
 */
interface ColorIndexMap {
    readonly BLACK: 0; readonly RED: 1; readonly GREEN: 2; readonly BROWN: 3; readonly BLUE: 4; readonly PURPLE: 5;
    readonly CYAN: 6; readonly LIGHT_GRAY: 7; readonly LIGHT_GREY: 7; readonly GRAY: 8; readonly GREY: 8;
    readonly PINK: 9; readonly LIME: 10; readonly YELLOW: 11; readonly LIGHT_BLUE: 12; readonly MAGENTA: 13;
    readonly ORANGE: 14; readonly WHITE: 15;
}

/** A color index, 0–15 (one of the ColorIndex values): the type of Term's color methods, like a numeric enum. */
type ColorIndex = ColorIndexMap[keyof ColorIndexMap];

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
