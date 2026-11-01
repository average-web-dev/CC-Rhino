// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `tty` — Node's tty module for CC TTYs (ROM module /rom/lib/tty), and the engine-internal `internal/pty` module behind
// it (its interfaces are generated from Java: PtyAPI, TtyHandle, PipeHandle).

/** Options for a tty.ReadStream (used by process.stdin). */
interface TtyReadStreamOptions {
    /** Who adds listeners now (the running job): removeAllListeners() only removes the current owner's. */
    owner?: () => number;
    /** Called when the stream starts (true) or stops (false) flowing. */
    onFlowing?: (flowing: boolean) => void;
}

/** A tty.ReadStream: what programs read from a TTY. */
interface TtyStdin extends TtyReadStream {
    /** Set readableFlowing directly (job control: a fresh stdin for a program). */
    setFlowing(value: boolean | null): void;
    /** Drop what was typed but not read yet. */
    discard(): void;
    /** Wait until input is available and return it (keys as with 'data'), or `undefined` at end of input. */
    readSync(): string | undefined;
    /** Like readSync, but keys as the terminal reported them (kitty sequences included), for decoders like Term. */
    readRawSync(): string | undefined;
    /**
     * How the terminal reports keys in raw mode: 'kitty' (the default) every key with its presses, repeats and
     * releases, 'legacy' only presses. 'data' and readSync look the same either way.
     */
    setKeyboardProtocol(protocol: "kitty" | "legacy"): this;
    getKeyboardProtocol(): "kitty" | "legacy";
    /** Remove the stream listeners added by `owner`. */
    removeListenersOf(owner: number): void;
}

/**
 * A TTY: `stdin` (what programs read; input() types into it), `stdout` / `stderr` (what programs write; for a virtual
 * TTY, readOutput() / readErrorOutput() read it).
 */
interface TTY {
    readonly stdin: TtyStdin;
    readonly stdout: TtyWriteStream;
    readonly stderr: TtyWriteStream;
    /** The native TTY. */
    readonly handle: TtyHandle;
    readonly columns: number;
    readonly rows: number;
    readonly isRaw: boolean;
    setRawMode(mode: boolean): this;
    isColor(): boolean;
    /** Resize a virtual TTY. */
    setSize(columns: number, rows: number): void;
    /** What programs write to `stdout` (a virtual TTY): blocks until there is some; `undefined` once it ended. */
    readOutput(): string | undefined;
    /** What programs write to `stderr` (a virtual TTY). */
    readErrorOutput(): string | undefined;
    /** Type into the TTY: the text passes its line discipline, as if typed. */
    input(text: string): void;
    /** The cursor column of the device showing this TTY (0 at the start of a line), or undefined for a virtual one. */
    cursorColumn(): number | undefined;
}

interface TTYConstructor {
    /** A virtual TTY (not shown anywhere), default 51 × 19. */
    new (columns?: number, rows?: number, options?: TtyReadStreamOptions): TTY;
    readonly prototype: TTY;
    /** Wrap a native TTY (`monitor.getTty()`, `require('screen').getConsole(n)`). */
    from(handle: TtyHandle, options?: TtyReadStreamOptions): TTY;
}

/** The escape sequences a TTY understands. */
interface TtyEscapes {
    /** Show the (blinking) cursor. */
    readonly showCursor: string;
    /** Hide the cursor. */
    readonly hideCursor: string;
    /** Clear the whole screen (the cursor stays). */
    readonly clearScreen: string;
    /** Move the cursor to the top left. */
    readonly home: string;
    /** Back to the default colours. */
    readonly reset: string;
    /** Select graphic rendition: SGR parameters such as `1` (bold), `31` (red text) or `39` (default text colour). */
    sgr(...params: number[]): string;
    /**
     * Select colours by their index (0–15, as on a Linux terminal: 0 black … 7 white, 8–15 bright): text, and
     * optionally background.
     */
    color(fg: number, bg?: number): string;
    /**
     * Let color `index` (0–15, as color() takes it) show `color` on this TTY only, until resetPalette() (xterm's OSC 4).
     * A terminal shows opaque colors, so a translucent one is taken over black: #ff0000 with alpha 0.5 is #7f0000.
     */
    setPaletteColor(index: number, color: Color): string;
    /** Let color `index` (or, without one, every color) show its default again (xterm's OSC 104). */
    resetPalette(index?: number): string;
    /** Scroll the contents up by `n` rows (down if negative). */
    scroll(n: number): string;
    /** Write `text` with one text and one background colour (blit digits) per character, without wrapping. */
    blit(text: string, fg: string, bg: string): string;
    /**
     * Ask for pasted text bracketed (`ESC [ 200 ~ … ESC [ 201 ~`: a 'paste' event instead of typed text), or stop it.
     */
    bracketedPaste(on: boolean): string;
    /**
     * Show the alternate screen (a cleared one, as full-screen programs like vi use; the cursor and colours are saved),
     * or the normal screen again as it was. A program's end leaves it.
     */
    alternateScreen(on: boolean): string;
    /** Ask for mouse reports in stdin (SGR encoding, presses, releases and drags), or stop them. */
    mouse(on: boolean): string;
    /**
     * Ask for the kitty keyboard protocol with these flags (KeyboardFlag, combined with `|`); the terminal keeps a
     * stack, so popKeyboardFlags() restores what was asked for before.
     */
    pushKeyboardFlags(flags: number): string;
    /** Undo the last `n` (default 1) pushKeyboardFlags. */
    popKeyboardFlags(n?: number): string;
    cursorTo(x: number, y?: number): string;
    moveCursor(dx: number, dy: number): string;
    /** -1: left of the cursor, 1: right of it, 0: the whole line. */
    clearLine(dir: number): string;
    readonly clearScreenDown: string;
}

/**
 * A key from tty.decodeInput(), Term.readKey() / readInput() and the stdin events 'keydown' / 'keyup', like the
 * browser's KeyboardEvent.
 */
interface TtyKeyInput {
    type: "keydown" | "keyup";
    /** What the key types (`"a"`, `"A"`, `"ä"`), or its name (`"Enter"`, `"ArrowUp"`, `"Shift"`, `"F1"`, …). */
    key: string;
    /** The physical key, as KeyboardEvent.code: compare against Key (`Key.KEY_A`, `Key.ARROW_UP`, …). */
    code: string;
    /** Whether the key is held and repeats. */
    repeat: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    /** The Super (Windows / Command) key. */
    metaKey: boolean;
    /** The characters the terminal sent for the key. */
    sequence: string;
}

type TtyMouseAction = "press" | "release" | "drag" | "move" | "scroll";
type TtyMouseButton = "left" | "middle" | "right";

/** A mouse report from tty.decodeInput() / Term.readInput() (only sent after `CSI.mouse(true)`). */
interface TtyMouseInput {
    type: "mouse";
    action: TtyMouseAction;
    /** The button pressed, released or dragged with (undefined for scroll, move and an X10 release). */
    button: TtyMouseButton | undefined;
    /** For scroll: -1 up, 1 down; otherwise 0. */
    direction: -1 | 0 | 1;
    /** Column, starting at 0 (as Term's cursor). */
    x: number;
    /** Row, starting at 0. */
    y: number;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    /** Never reported by terminals; false. */
    metaKey: boolean;
    /** The characters of the report. */
    sequence: string;
}

/**
 * Pasted text, from tty.decodeInput() / Term.readInput() / stdin's 'paste' event: only sent bracketed (so it can be
 * told apart from typing) after `CSI.bracketedPaste(true)`; otherwise a paste arrives as typed text.
 */
interface TtyPasteInput {
    type: "paste";
    /** The pasted text, line endings as `"\r"`. */
    text: string;
    /** The characters of the bracketed paste (`ESC [ 200 ~ … ESC [ 201 ~`). */
    sequence: string;
}

/** What a TTY delivers, decoded: compare `type` against InputType. */
type TtyInput = TtyKeyInput | TtyMouseInput | TtyPasteInput;

interface TtyInputTypes {
    readonly KEY_DOWN: "keydown"; readonly KEY_UP: "keyup"; readonly MOUSE: "mouse"; readonly PASTE: "paste";
}

/** The flags of the kitty keyboard protocol (CSI.pushKeyboardFlags). */
interface TtyKeyboardFlags {
    /** Escape codes for keys that are ambiguous otherwise: Esc, Alt/Ctrl+key, the keypad. */
    readonly DISAMBIGUATE: 1;
    /** Report repeats and releases. */
    readonly REPORT_EVENT_TYPES: 2;
    /** Report the shifted key too. */
    readonly REPORT_ALTERNATE_KEYS: 4;
    /** Every key as an escape code, also text keys, Enter, Tab, Backspace and modifier keys. */
    readonly REPORT_ALL_KEYS: 8;
    /** With REPORT_ALL_KEYS: the text a key types, as part of its escape code. */
    readonly REPORT_TEXT: 16;
}

/** The physical keys (`event.code`, as KeyboardEvent.code). */
interface TtyKeyCodes {
    readonly KEY_A: "KeyA"; readonly KEY_B: "KeyB"; readonly KEY_C: "KeyC"; readonly KEY_D: "KeyD";
    readonly KEY_E: "KeyE"; readonly KEY_F: "KeyF"; readonly KEY_G: "KeyG"; readonly KEY_H: "KeyH";
    readonly KEY_I: "KeyI"; readonly KEY_J: "KeyJ"; readonly KEY_K: "KeyK"; readonly KEY_L: "KeyL";
    readonly KEY_M: "KeyM"; readonly KEY_N: "KeyN"; readonly KEY_O: "KeyO"; readonly KEY_P: "KeyP";
    readonly KEY_Q: "KeyQ"; readonly KEY_R: "KeyR"; readonly KEY_S: "KeyS"; readonly KEY_T: "KeyT";
    readonly KEY_U: "KeyU"; readonly KEY_V: "KeyV"; readonly KEY_W: "KeyW"; readonly KEY_X: "KeyX";
    readonly KEY_Y: "KeyY"; readonly KEY_Z: "KeyZ";
    readonly DIGIT_0: "Digit0"; readonly DIGIT_1: "Digit1"; readonly DIGIT_2: "Digit2"; readonly DIGIT_3: "Digit3";
    readonly DIGIT_4: "Digit4"; readonly DIGIT_5: "Digit5"; readonly DIGIT_6: "Digit6"; readonly DIGIT_7: "Digit7";
    readonly DIGIT_8: "Digit8"; readonly DIGIT_9: "Digit9";
    readonly MINUS: "Minus"; readonly EQUAL: "Equal"; readonly BRACKET_LEFT: "BracketLeft";
    readonly BRACKET_RIGHT: "BracketRight"; readonly BACKSLASH: "Backslash"; readonly SEMICOLON: "Semicolon";
    readonly QUOTE: "Quote"; readonly BACKQUOTE: "Backquote"; readonly COMMA: "Comma"; readonly PERIOD: "Period";
    readonly SLASH: "Slash"; readonly SPACE: "Space";
    readonly ENTER: "Enter"; readonly TAB: "Tab"; readonly BACKSPACE: "Backspace"; readonly ESCAPE: "Escape";
    readonly ARROW_UP: "ArrowUp"; readonly ARROW_DOWN: "ArrowDown"; readonly ARROW_LEFT: "ArrowLeft";
    readonly ARROW_RIGHT: "ArrowRight"; readonly HOME: "Home"; readonly END: "End"; readonly PAGE_UP: "PageUp";
    readonly PAGE_DOWN: "PageDown"; readonly INSERT: "Insert"; readonly DELETE: "Delete";
    readonly F1: "F1"; readonly F2: "F2"; readonly F3: "F3"; readonly F4: "F4"; readonly F5: "F5"; readonly F6: "F6";
    readonly F7: "F7"; readonly F8: "F8"; readonly F9: "F9"; readonly F10: "F10"; readonly F11: "F11";
    readonly F12: "F12"; readonly F13: "F13"; readonly F14: "F14"; readonly F15: "F15"; readonly F16: "F16";
    readonly F17: "F17"; readonly F18: "F18"; readonly F19: "F19"; readonly F20: "F20"; readonly F21: "F21";
    readonly F22: "F22"; readonly F23: "F23"; readonly F24: "F24"; readonly F25: "F25";
    readonly NUMPAD_0: "Numpad0"; readonly NUMPAD_1: "Numpad1"; readonly NUMPAD_2: "Numpad2";
    readonly NUMPAD_3: "Numpad3"; readonly NUMPAD_4: "Numpad4"; readonly NUMPAD_5: "Numpad5";
    readonly NUMPAD_6: "Numpad6"; readonly NUMPAD_7: "Numpad7"; readonly NUMPAD_8: "Numpad8";
    readonly NUMPAD_9: "Numpad9"; readonly NUMPAD_DECIMAL: "NumpadDecimal"; readonly NUMPAD_DIVIDE: "NumpadDivide";
    readonly NUMPAD_MULTIPLY: "NumpadMultiply"; readonly NUMPAD_SUBTRACT: "NumpadSubtract";
    readonly NUMPAD_ADD: "NumpadAdd"; readonly NUMPAD_ENTER: "NumpadEnter"; readonly NUMPAD_EQUAL: "NumpadEqual";
    readonly SHIFT_LEFT: "ShiftLeft"; readonly SHIFT_RIGHT: "ShiftRight"; readonly CONTROL_LEFT: "ControlLeft";
    readonly CONTROL_RIGHT: "ControlRight"; readonly ALT_LEFT: "AltLeft"; readonly ALT_RIGHT: "AltRight";
    readonly META_LEFT: "MetaLeft"; readonly META_RIGHT: "MetaRight";
    readonly CAPS_LOCK: "CapsLock"; readonly SCROLL_LOCK: "ScrollLock"; readonly NUM_LOCK: "NumLock";
    readonly PRINT_SCREEN: "PrintScreen"; readonly PAUSE: "Pause"; readonly CONTEXT_MENU: "ContextMenu";
    /** A key whose physical position is not known (a character a US keyboard cannot type). */
    readonly UNIDENTIFIED: "Unidentified";
}
interface TtyMouseActions {
    readonly PRESS: "press"; readonly RELEASE: "release"; readonly DRAG: "drag"; readonly MOVE: "move";
    readonly SCROLL: "scroll";
}
interface TtyMouseButtons { readonly LEFT: "left"; readonly MIDDLE: "middle"; readonly RIGHT: "right"; }

interface TtyModule {
    TTY: TTYConstructor;
    ReadStream: { new (tty: TtyHandle, options?: TtyReadStreamOptions): TtyStdin; readonly prototype: TtyStdin };
    WriteStream: { new (tty: TtyHandle, pipe: PipeHandle, fd: number): TtyWriteStream; readonly prototype: TtyWriteStream };
    CSI: TtyEscapes;
    /** The other direction of CSI: split terminal input into keys and mouse events, in order. */
    decodeInput(data: string): TtyInput[];
    InputType: TtyInputTypes;
    MouseAction: TtyMouseActions;
    MouseButton: TtyMouseButtons;
    /** The physical keys: compare `event.code` against these. */
    Key: TtyKeyCodes;
    KeyboardFlag: TtyKeyboardFlags;
    /** Whether `fd` is a TTY: process.stdin/stdout/stderr (0, 1, 2) always are. */
    isatty(fd: number): boolean;
}

declare function require(id: "tty"): TtyModule;
declare function require(id: "node:tty"): TtyModule;
declare module "tty" { const tty: TtyModule; export = tty; }
declare module "node:tty" { const tty: TtyModule; export = tty; }

declare module "internal/pty" { const pty: PtyAPI; export = pty; }
declare module "internal/pty/promises" { const ptyPromises: PtyAPIPromises; export = ptyPromises; }

interface CustomEventMap {
    /** The last program running on a TTY ended (emitted by the ROM's job control; `tty` is the native TTY id). */
    tty_released: [tty: number];
    /** A program wrote a BEL (`\x07`) to a TTY (emitted by tty.WriteStream; the OS plays it on a speaker). */
    tty_bell: [tty: number];
}
