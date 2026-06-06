// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `term` — terminal output. Multiple returns become objects; coordinates are 0-based.

/** Cursor position. 0-based: `{ x: 0, y: 0 }` is the top-left cell. */
interface CursorPos {
    x: number;
    y: number;
}

/** Terminal size in cells. */
interface TermSize {
    width: number;
    height: number;
}

/** An RGB colour, each channel in [0, 1]. */
interface RGB {
    r: number;
    g: number;
    b: number;
}

interface TermModule {
    write(text: string): void;
    blit(text: string, fg: string, bg: string): void;
    scroll(y: number): void;
    clear(): void;
    clearLine(): void;

    /** Get the cursor position (0-based). */
    getCursorPos(): CursorPos;
    /** Set the cursor position (0-based), given as a `{ x, y }` object in the same shape {@link getCursorPos} returns. */
    setCursorPos(pos: CursorPos): void;

    getCursorBlink(): boolean;
    setCursorBlink(blink: boolean): void;

    getSize(): TermSize;

    getTextColor(): Color;
    setTextColor(color: Color): void;
    getBackgroundColor(): Color;
    setBackgroundColor(color: Color): void;

    isColor(): boolean;

    getPaletteColor(color: Color): RGB;
    setPaletteColor(color: Color, rgb: number): void;
    setPaletteColor(color: Color, r: number, g: number, b: number): void;

    /** The default (built-in) palette value for a colour. */
    nativePaletteColor(color: Color): RGB;
}
