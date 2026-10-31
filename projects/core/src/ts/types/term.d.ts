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
 * on any TTY (a console of the screen, a monitor, a virtual TTY). Colours apply to what is written through this Term
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
    /** The text colour (a CC colour: a power of two, as `colors`). */
    getTextColor(): number;
    setTextColor(colour: number): void;
    getBackgroundColor(): number;
    setBackgroundColor(colour: number): void;
    /**
     * Write text at the cursor in this Term's colours, cut off at the right edge (never wraps, so drawing on the last row
     * does not scroll); `\n` starts a new row. The cursor moves behind the text, also past the edge.
     */
    write(text: string): void;
    /** Write text and start a new row, wrapping at the Term's width (scrolling at the bottom), like console.log. */
    print(text?: string): void;
    /** Write `text` with one colour per character (blit digits `0` … `f`), without wrapping. */
    blit(text: string, textColour: string, backgroundColour: string): void;
    /** Clear the whole TTY in the background colour (the cursor stays). */
    clear(): void;
    /** Clear the cursor's row in the background colour (the cursor stays). */
    clearLine(): void;
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): void;
    /**
     * Wait for the next input: a key or (after `CSI.mouse(true)`) a mouse event, or `undefined` at end of input.
     * Compare `type` against InputType, `action` against MouseAction, `button` against MouseButton.
     */
    readInput(): TtyInput | undefined;
    /** Wait for a key (a Node key object), or `undefined` at end of input. Mouse reports are skipped. */
    readKey(): Key | undefined;
    /** Wait for one character of input, or `undefined` at end of input. */
    readChar(): string | undefined;
    /** Wait for a line of input (without its line ending), or `undefined` at end of input. */
    readLine(): string | undefined;
}

interface TermConstructor {
    /** A Term over `tty`, or (without one) over the calling program's process.stdin / process.stdout. */
    new (tty?: TTY): Term;
    readonly prototype: Term;
}

/** The names of the keys Term.readKey() returns (`key.name`): compare against these instead of strings. */
interface KeyNames {
    readonly UP: "up"; readonly DOWN: "down"; readonly LEFT: "left"; readonly RIGHT: "right";
    readonly HOME: "home"; readonly END: "end"; readonly PAGE_UP: "pageup"; readonly PAGE_DOWN: "pagedown";
    readonly INSERT: "insert"; readonly DELETE: "delete"; readonly CLEAR: "clear"; readonly RETURN: "return";
    readonly ENTER: "enter"; readonly TAB: "tab"; readonly BACKSPACE: "backspace"; readonly ESCAPE: "escape";
    readonly SPACE: "space";
    readonly F1: "f1"; readonly F2: "f2"; readonly F3: "f3"; readonly F4: "f4"; readonly F5: "f5"; readonly F6: "f6";
    readonly F7: "f7"; readonly F8: "f8"; readonly F9: "f9"; readonly F10: "f10"; readonly F11: "f11";
    readonly F12: "f12";
}

interface TermModule {
    Term: TermConstructor;
    KeyName: KeyNames;
    InputType: TtyInputTypes;
    MouseAction: TtyMouseActions;
    MouseButton: TtyMouseButtons;
}

declare function require(id: "term"): TermModule;
declare module "term" { const term: TermModule; export = term; }
