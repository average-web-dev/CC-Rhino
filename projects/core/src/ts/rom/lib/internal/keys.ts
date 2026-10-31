// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/keys.ts — decoding terminal input (the characters and escape sequences a TTY delivers) into
// keyboard events (like the browser's KeyboardEvent: `type`, `key`, `code`, `repeat`, `ctrlKey` …) and mouse events.
// Used by the tty streams ('keydown' / 'keyup'), readline, tty.decodeInput and Term.
//
// Keys arrive in two encodings: the legacy one (text as typed, xterm sequences for cursor and function keys; only
// presses, `code` guessed from a US keyboard) and the kitty keyboard protocol, once a program asked for it with
// CSI.pushKeyboardFlags (`CSI code;modifiers:event;text u`: presses, repeats and releases of every key, with its
// physical key as `code`). Both decode to the same events.

/**
 * The physical keys (`event.code`, as the browser's KeyboardEvent.code), so code compares against constants, not
 * strings: `if (event.code === Key.ARROW_UP) …`.
 */
export const Key = Object.freeze({
    KEY_A: 'KeyA', KEY_B: 'KeyB', KEY_C: 'KeyC', KEY_D: 'KeyD', KEY_E: 'KeyE', KEY_F: 'KeyF', KEY_G: 'KeyG',
    KEY_H: 'KeyH', KEY_I: 'KeyI', KEY_J: 'KeyJ', KEY_K: 'KeyK', KEY_L: 'KeyL', KEY_M: 'KeyM', KEY_N: 'KeyN',
    KEY_O: 'KeyO', KEY_P: 'KeyP', KEY_Q: 'KeyQ', KEY_R: 'KeyR', KEY_S: 'KeyS', KEY_T: 'KeyT', KEY_U: 'KeyU',
    KEY_V: 'KeyV', KEY_W: 'KeyW', KEY_X: 'KeyX', KEY_Y: 'KeyY', KEY_Z: 'KeyZ',
    DIGIT_0: 'Digit0', DIGIT_1: 'Digit1', DIGIT_2: 'Digit2', DIGIT_3: 'Digit3', DIGIT_4: 'Digit4', DIGIT_5: 'Digit5',
    DIGIT_6: 'Digit6', DIGIT_7: 'Digit7', DIGIT_8: 'Digit8', DIGIT_9: 'Digit9',
    MINUS: 'Minus', EQUAL: 'Equal', BRACKET_LEFT: 'BracketLeft', BRACKET_RIGHT: 'BracketRight',
    BACKSLASH: 'Backslash', SEMICOLON: 'Semicolon', QUOTE: 'Quote', BACKQUOTE: 'Backquote', COMMA: 'Comma',
    PERIOD: 'Period', SLASH: 'Slash', SPACE: 'Space',
    ENTER: 'Enter', TAB: 'Tab', BACKSPACE: 'Backspace', ESCAPE: 'Escape',
    ARROW_UP: 'ArrowUp', ARROW_DOWN: 'ArrowDown', ARROW_LEFT: 'ArrowLeft', ARROW_RIGHT: 'ArrowRight',
    HOME: 'Home', END: 'End', PAGE_UP: 'PageUp', PAGE_DOWN: 'PageDown', INSERT: 'Insert', DELETE: 'Delete',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11',
    F12: 'F12', F13: 'F13', F14: 'F14', F15: 'F15', F16: 'F16', F17: 'F17', F18: 'F18', F19: 'F19', F20: 'F20',
    F21: 'F21', F22: 'F22', F23: 'F23', F24: 'F24', F25: 'F25',
    NUMPAD_0: 'Numpad0', NUMPAD_1: 'Numpad1', NUMPAD_2: 'Numpad2', NUMPAD_3: 'Numpad3', NUMPAD_4: 'Numpad4',
    NUMPAD_5: 'Numpad5', NUMPAD_6: 'Numpad6', NUMPAD_7: 'Numpad7', NUMPAD_8: 'Numpad8', NUMPAD_9: 'Numpad9',
    NUMPAD_DECIMAL: 'NumpadDecimal', NUMPAD_DIVIDE: 'NumpadDivide', NUMPAD_MULTIPLY: 'NumpadMultiply',
    NUMPAD_SUBTRACT: 'NumpadSubtract', NUMPAD_ADD: 'NumpadAdd', NUMPAD_ENTER: 'NumpadEnter', NUMPAD_EQUAL: 'NumpadEqual',
    SHIFT_LEFT: 'ShiftLeft', SHIFT_RIGHT: 'ShiftRight', CONTROL_LEFT: 'ControlLeft', CONTROL_RIGHT: 'ControlRight',
    ALT_LEFT: 'AltLeft', ALT_RIGHT: 'AltRight', META_LEFT: 'MetaLeft', META_RIGHT: 'MetaRight',
    CAPS_LOCK: 'CapsLock', SCROLL_LOCK: 'ScrollLock', NUM_LOCK: 'NumLock', PRINT_SCREEN: 'PrintScreen',
    PAUSE: 'Pause', CONTEXT_MENU: 'ContextMenu',
    /** A key whose physical position is not known (a character a US keyboard cannot type). */
    UNIDENTIFIED: 'Unidentified',
} as const);

/** The kinds of input tty.decodeInput() returns (`input.type`). */
export const InputType = { KEY_DOWN: 'keydown', KEY_UP: 'keyup', MOUSE: 'mouse', PASTE: 'paste' } as const;

/** What a mouse report says happened (`input.action`). */
export const MouseAction = {
    PRESS: 'press', RELEASE: 'release', DRAG: 'drag', MOVE: 'move', SCROLL: 'scroll',
} as const;

/** The mouse buttons (`input.button`). */
export const MouseButton = { LEFT: 'left', MIDDLE: 'middle', RIGHT: 'right' } as const;

// ── Tables ───────────────────────────────────────────────────────────────────────

/** Characters a US keyboard types: their physical key, and whether they need Shift. */
const US_KEYS: Record<string, [string, boolean]> = {
    ' ': [Key.SPACE, false], '-': [Key.MINUS, false], '_': [Key.MINUS, true], '=': [Key.EQUAL, false],
    '+': [Key.EQUAL, true], '[': [Key.BRACKET_LEFT, false], '{': [Key.BRACKET_LEFT, true],
    ']': [Key.BRACKET_RIGHT, false], '}': [Key.BRACKET_RIGHT, true], '\\': [Key.BACKSLASH, false],
    '|': [Key.BACKSLASH, true], ';': [Key.SEMICOLON, false], ':': [Key.SEMICOLON, true], "'": [Key.QUOTE, false],
    '"': [Key.QUOTE, true], '`': [Key.BACKQUOTE, false], '~': [Key.BACKQUOTE, true], ',': [Key.COMMA, false],
    '<': [Key.COMMA, true], '.': [Key.PERIOD, false], '>': [Key.PERIOD, true], '/': [Key.SLASH, false],
    '?': [Key.SLASH, true], ')': [Key.DIGIT_0, true], '!': [Key.DIGIT_1, true], '@': [Key.DIGIT_2, true],
    '#': [Key.DIGIT_3, true], '$': [Key.DIGIT_4, true], '%': [Key.DIGIT_5, true], '^': [Key.DIGIT_6, true],
    '&': [Key.DIGIT_7, true], '*': [Key.DIGIT_8, true], '(': [Key.DIGIT_9, true],
};

/** The physical key of a character on a US keyboard. */
function usKey(ch: string): [string, boolean] {
    if (/^[a-z]$/.test(ch)) return ['Key' + ch.toUpperCase(), false];
    if (/^[A-Z]$/.test(ch)) return ['Key' + ch, true];
    if (/^[0-9]$/.test(ch)) return ['Digit' + ch, false];
    return US_KEYS[ch] ?? [Key.UNIDENTIFIED, false];
}

/** xterm CSI sequences (final character, or number + '~'): physical key and `key` value. */
const CSI_KEYS: Record<string, string> = {
    A: Key.ARROW_UP, B: Key.ARROW_DOWN, C: Key.ARROW_RIGHT, D: Key.ARROW_LEFT, H: Key.HOME, F: Key.END,
    E: Key.NUMPAD_5, '1~': Key.HOME, '2~': Key.INSERT, '3~': Key.DELETE, '4~': Key.END, '5~': Key.PAGE_UP,
    '6~': Key.PAGE_DOWN, '7~': Key.HOME, '8~': Key.END, P: Key.F1, Q: Key.F2, R: Key.F3, S: Key.F4, '13~': Key.F3,
    '15~': Key.F5, '17~': Key.F6, '18~': Key.F7, '19~': Key.F8, '20~': Key.F9, '21~': Key.F10, '23~': Key.F11,
    '24~': Key.F12,
};

/** The kitty protocol's numbers for keys without a character: physical key and `key` value. */
const KITTY_KEYS: Record<number, [string, string]> = {
    27: [Key.ESCAPE, 'Escape'], 13: [Key.ENTER, 'Enter'], 9: [Key.TAB, 'Tab'], 127: [Key.BACKSPACE, 'Backspace'],
    57358: [Key.CAPS_LOCK, 'CapsLock'], 57359: [Key.SCROLL_LOCK, 'ScrollLock'], 57360: [Key.NUM_LOCK, 'NumLock'],
    57361: [Key.PRINT_SCREEN, 'PrintScreen'], 57362: [Key.PAUSE, 'Pause'], 57363: [Key.CONTEXT_MENU, 'ContextMenu'],
    57409: [Key.NUMPAD_DECIMAL, '.'], 57410: [Key.NUMPAD_DIVIDE, '/'], 57411: [Key.NUMPAD_MULTIPLY, '*'],
    57412: [Key.NUMPAD_SUBTRACT, '-'], 57413: [Key.NUMPAD_ADD, '+'], 57414: [Key.NUMPAD_ENTER, 'Enter'],
    57415: [Key.NUMPAD_EQUAL, '='],
    57441: [Key.SHIFT_LEFT, 'Shift'], 57442: [Key.CONTROL_LEFT, 'Control'], 57443: [Key.ALT_LEFT, 'Alt'],
    57444: [Key.META_LEFT, 'Meta'], 57447: [Key.SHIFT_RIGHT, 'Shift'], 57448: [Key.CONTROL_RIGHT, 'Control'],
    57449: [Key.ALT_RIGHT, 'Alt'], 57450: [Key.META_RIGHT, 'Meta'],
};
for (let i = 0; i <= 9; i++) KITTY_KEYS[57399 + i] = ['Numpad' + i, String(i)];
for (let i = 13; i <= 25; i++) KITTY_KEYS[57376 + i - 13] = ['F' + i, 'F' + i];

/** The modifier keys, which type nothing on their own. */
const MODIFIER_KEYS: Record<string, true> = {
    [Key.SHIFT_LEFT]: true, [Key.SHIFT_RIGHT]: true, [Key.CONTROL_LEFT]: true, [Key.CONTROL_RIGHT]: true,
    [Key.ALT_LEFT]: true, [Key.ALT_RIGHT]: true, [Key.META_LEFT]: true, [Key.META_RIGHT]: true,
};

/** Whether `code` is a modifier key (Shift, Control, Alt, Meta). */
export function isModifierKey(code: string): boolean {
    return MODIFIER_KEYS[code] === true;
}

// ── Mouse ────────────────────────────────────────────────────────────────────────

/** A mouse report from the TTY (see the xterm mouse protocols). */
export interface MouseReport {
    /**
     * The xterm button code: 0 left, 1 middle, 2 right (3 none: an X10 release or plain motion), +32 motion, 64/65
     * scroll; modifiers +4 shift, +8 alt, +16 ctrl.
     */
    code: number;
    /** Column, starting at 1. */
    x: number;
    /** Row, starting at 1. */
    y: number;
    release: boolean;
}

/**
 * The length of the mouse report at `data[i]` (an ESC), or 0 if there is none: SGR (`ESC [ < b ; x ; y M/m`) or X10
 * (`ESC [ M b x y`).
 */
export function mouseReportAt(data: string, i: number, report?: (mouse: MouseReport) => void): number {
    if (data.charAt(i) !== '\x1b' || data.charAt(i + 1) !== '[') return 0;
    let kind = data.charAt(i + 2);
    if (kind === '<') {
        let j = i + 3;
        while (j < data.length && /[0-9;]/.test(data.charAt(j))) j++;
        let final = data.charAt(j);
        if (final !== 'M' && final !== 'm') return 0;
        let parts = data.slice(i + 3, j).split(';');
        if (report !== undefined) {
            report({
                code: parseInt(parts[0], 10) || 0, x: parseInt(parts[1], 10) || 1, y: parseInt(parts[2], 10) || 1,
                release: final === 'm',
            });
        }
        return j + 1 - i;
    }
    if (kind === 'M' && data.length >= i + 6) {
        let code = data.charCodeAt(i + 3) - 32;
        if (report !== undefined) {
            report({
                code, x: data.charCodeAt(i + 4) - 32, y: data.charCodeAt(i + 5) - 32, release: (code & 3) === 3,
            });
        }
        return 6;
    }
    return 0;
}

const BUTTONS: (TtyMouseButton | undefined)[] = [MouseButton.LEFT, MouseButton.MIDDLE, MouseButton.RIGHT, undefined];
const MOUSE_SHIFT = 4;
const MOUSE_ALT = 8;
const MOUSE_CTRL = 16;
const MOUSE_MOTION = 32;
const MOUSE_WHEEL = 64;

/** A mouse report as a mouse event (coordinates from 0, like Term's cursor). */
function mouseInput(report: MouseReport, sequence: string): TtyMouseInput {
    let code = report.code;
    let button = BUTTONS[code & 3];
    let action: TtyMouseAction;
    let direction: -1 | 0 | 1 = 0;
    if ((code & MOUSE_WHEEL) !== 0) {
        action = MouseAction.SCROLL;
        direction = (code & 1) === 0 ? -1 : 1;
        button = undefined;
    } else if (report.release) {
        action = MouseAction.RELEASE;
    } else if ((code & MOUSE_MOTION) !== 0) {
        action = button === undefined ? MouseAction.MOVE : MouseAction.DRAG;
    } else {
        action = MouseAction.PRESS;
    }
    return {
        type: InputType.MOUSE, action, button, direction, x: report.x - 1, y: report.y - 1,
        ctrlKey: (code & MOUSE_CTRL) !== 0, shiftKey: (code & MOUSE_SHIFT) !== 0, altKey: (code & MOUSE_ALT) !== 0,
        metaKey: false, sequence,
    };
}

// ── Keys ─────────────────────────────────────────────────────────────────────────

const MOD_SHIFT = 1;
const MOD_ALT = 2;
const MOD_CTRL = 4;
const MOD_META = 8;
const EVENT_REPEAT = 2;
const EVENT_RELEASE = 3;

function keyEvent(
    key: string, code: string, sequence: string, modifiers = 0, event = 1,
): TtyKeyInput {
    return {
        type: event === EVENT_RELEASE ? InputType.KEY_UP : InputType.KEY_DOWN, key, code,
        repeat: event === EVENT_REPEAT, ctrlKey: (modifiers & MOD_CTRL) !== 0, shiftKey: (modifiers & MOD_SHIFT) !== 0,
        altKey: (modifiers & MOD_ALT) !== 0, metaKey: (modifiers & MOD_META) !== 0, sequence,
    };
}

/** One character of legacy input (a typed character or a control character). */
function decodeChar(ch: string, sequence: string, alt: boolean): TtyKeyInput {
    let mods = alt ? MOD_ALT : 0;
    let c = ch.charCodeAt(0);
    switch (ch) {
        case '\r': case '\n': return keyEvent('Enter', Key.ENTER, sequence, mods);
        case '\t': return keyEvent('Tab', Key.TAB, sequence, mods);
        case '\x7f': return keyEvent('Backspace', Key.BACKSPACE, sequence, mods);
        case '\b': return keyEvent('Backspace', Key.BACKSPACE, sequence, mods | MOD_CTRL);
        case '\x1b': return keyEvent('Escape', Key.ESCAPE, sequence, mods);
        default:
    }
    if (c > 0 && c <= 26) {
        // Ctrl+letter.
        let letter = String.fromCharCode(c + 96);
        return keyEvent(letter, usKey(letter)[0], sequence, mods | MOD_CTRL);
    }
    let [code, shift] = usKey(ch);
    return keyEvent(ch, code, sequence, mods | (shift ? MOD_SHIFT : 0));
}

/** The modifier parameter (`1 + bits`, optionally `:event`) of a CSI key sequence: [modifier bits, event type]. */
function parseModifiers(field: string | undefined): [number, number] {
    if (field === undefined || field === '') return [0, 1];
    let [mods, event] = field.split(':');
    return [Math.max((parseInt(mods, 10) || 1) - 1, 0), parseInt(event, 10) || 1];
}

/** A kitty `CSI … u` key: `code[:shifted[:base]] ; modifiers[:event] ; text`. */
function decodeKittyKey(params: string, sequence: string): TtyKeyInput {
    let fields = params.split(';');
    let [number, shifted] = fields[0].split(':').map((n) => parseInt(n, 10));
    let [mods, event] = parseModifiers(fields[1]);
    let text = fields[2] === undefined || fields[2] === ''
        ? undefined
        : String.fromCharCode(...fields[2].split(':').map((n) => parseInt(n, 10) || 0));
    let known = KITTY_KEYS[number];
    if (known !== undefined) return keyEvent(known[1], known[0], sequence, mods, event);
    let base = String.fromCharCode(number);
    let key = text ?? ((mods & MOD_SHIFT) !== 0
        ? (Number.isNaN(shifted) || shifted === undefined ? base.toUpperCase() : String.fromCharCode(shifted))
        : base);
    return keyEvent(key, usKey(base)[0], sequence, mods, event);
}

/** A CSI (or SS3) key sequence other than `u`: cursor, editing and function keys. */
function decodeCsiKey(params: string, final: string, sequence: string): TtyKeyInput {
    let fields = params.split(';');
    if (final === 'Z') return keyEvent('Tab', Key.TAB, sequence, MOD_SHIFT);
    let id = final === '~' ? (fields[0] || '') + '~' : final;
    let [mods, event] = parseModifiers(fields[1]);
    let code = CSI_KEYS[id] ?? Key.UNIDENTIFIED;
    let key = code === Key.NUMPAD_5 ? 'Clear' : code === Key.UNIDENTIFIED ? 'Unidentified' : code;
    return keyEvent(key, code, sequence, mods, event);
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * The length of the bracketed paste (`ESC [ 200 ~ text ESC [ 201 ~`, sent when a program asked for it with
 * CSI.bracketedPaste) at `data[i]`, or 0 if there is none; an unterminated one runs to the end of `data`.
 */
function pasteAt(data: string, i: number): number {
    if (!data.startsWith(PASTE_START, i)) return 0;
    let end = data.indexOf(PASTE_END, i + PASTE_START.length);
    return end < 0 ? data.length - i : end + PASTE_END.length - i;
}

/** The text of a bracketed paste sequence. */
function pasteText(sequence: string): string {
    let text = sequence.slice(PASTE_START.length);
    return text.endsWith(PASTE_END) ? text.slice(0, -PASTE_END.length) : text;
}

/** Split terminal input into keyboard, mouse and paste events, in order. */
function decode(data: string, onInput: (input: TtyInput) => void): void {
    let i = 0;
    while (i < data.length) {
        let ch = data.charAt(i);
        if (ch !== '\x1b') {
            onInput(decodeChar(ch, ch, false));
            i++;
            continue;
        }
        let paste = pasteAt(data, i);
        if (paste > 0) {
            let sequence = data.slice(i, i + paste);
            onInput({ type: InputType.PASTE, text: pasteText(sequence), sequence });
            i += paste;
            continue;
        }
        let report: MouseReport | undefined;
        let length = mouseReportAt(data, i, (r) => { report = r; });
        if (length > 0) {
            onInput(mouseInput(report!, data.slice(i, i + length)));
            i += length;
            continue;
        }
        let next = data.charAt(i + 1);
        if (next === '[' || next === 'O') {
            let j = i + 2;
            while (j < data.length && /[0-9;:]/.test(data.charAt(j))) j++;
            let params = data.slice(i + 2, j);
            let final = data.charAt(j);
            let sequence = data.slice(i, j + 1);
            onInput(final === 'u' && next === '['
                ? decodeKittyKey(params, sequence)
                : decodeCsiKey(params, final, sequence));
            i = j + 1;
            continue;
        }
        if (next === '') {
            onInput(decodeChar('\x1b', '\x1b', false));
            i++;
            continue;
        }
        // ESC + character: the character with Alt.
        onInput(decodeChar(next, '\x1b' + next, true));
        i += 2;
    }
}

/** Decode terminal input into keyboard, mouse and paste events, in order (the counterpart of tty.CSI). */
export function decodeInput(data: string): TtyInput[] {
    let out: TtyInput[] = [];
    decode(data, (input) => { out.push(input); });
    return out;
}

// ── Back to the legacy encoding ─────────────────────────────────────────────────

const LEGACY_CURSOR: Record<string, string> = {
    [Key.ARROW_UP]: 'A', [Key.ARROW_DOWN]: 'B', [Key.ARROW_RIGHT]: 'C', [Key.ARROW_LEFT]: 'D', [Key.HOME]: 'H',
    [Key.END]: 'F',
};
const LEGACY_TILDE: Record<string, number> = {
    [Key.INSERT]: 2, [Key.DELETE]: 3, [Key.PAGE_UP]: 5, [Key.PAGE_DOWN]: 6, [Key.F5]: 15, [Key.F6]: 17, [Key.F7]: 18,
    [Key.F8]: 19, [Key.F9]: 20, [Key.F10]: 21, [Key.F11]: 23, [Key.F12]: 24,
};
const LEGACY_SS3: Record<string, string> = { [Key.F1]: 'P', [Key.F2]: 'Q', [Key.F3]: 'R', [Key.F4]: 'S' };

/** What a terminal without the kitty protocol sends for a key press ('' for keys it sends nothing for). */
function legacySequence(event: TtyKeyInput): string {
    let alt = event.altKey ? '\x1b' : '';
    let mods = 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
    switch (event.code) {
        case Key.ENTER: case Key.NUMPAD_ENTER: return alt + '\r';
        case Key.TAB: return event.shiftKey ? '\x1b[Z' : alt + '\t';
        case Key.BACKSPACE: return alt + '\x7f';
        case Key.ESCAPE: return alt + '\x1b';
        default:
    }
    let cursor = LEGACY_CURSOR[event.code];
    if (cursor !== undefined) return mods > 1 ? `\x1b[1;${mods}${cursor}` : `\x1b[${cursor}`;
    let tilde = LEGACY_TILDE[event.code];
    if (tilde !== undefined) return `\x1b[${tilde}${mods > 1 ? ';' + mods : ''}~`;
    let ss3 = LEGACY_SS3[event.code];
    if (ss3 !== undefined) return mods > 1 ? `\x1b[1;${mods}${ss3}` : `\x1bO${ss3}`;
    // Modifier keys, locks, F13 and up: nothing. Otherwise the key types its text (Ctrl+letter a control character).
    if (Array.from(event.key).length !== 1) return '';
    if (event.ctrlKey) {
        let c = event.key.toLowerCase().charCodeAt(0);
        return c >= 97 && c <= 122 ? alt + String.fromCharCode(c - 96) : '';
    }
    return alt + event.key;
}

/**
 * Terminal input with kitty-encoded keys rewritten as a terminal without the protocol would send them: presses as
 * text and xterm sequences, releases dropped; everything else (text, legacy sequences, mouse reports) unchanged. So
 * readers of raw input ('data', readChar, …) see what Node programs expect, whichever encoding the terminal uses.
 */
export function toLegacy(data: string): string {
    if (data.indexOf('\x1b[') < 0) return data;
    let out = '';
    let i = 0;
    while (i < data.length) {
        let paste = pasteAt(data, i);
        if (paste > 0) {
            out += data.slice(i, i + paste); // pasted text is not keys
            i += paste;
            continue;
        }
        if (data.charAt(i) === '\x1b' && data.charAt(i + 1) === '[' && mouseReportAt(data, i) === 0) {
            let j = i + 2;
            while (j < data.length && /[0-9;:]/.test(data.charAt(j))) j++;
            let params = data.slice(i + 2, j);
            let final = data.charAt(j);
            let sequence = data.slice(i, j + 1);
            if (final === 'u' || params.indexOf(':') >= 0) {
                let event = final === 'u' ? decodeKittyKey(params, sequence) : decodeCsiKey(params, final, sequence);
                if (event.type === InputType.KEY_DOWN) out += legacySequence(event);
            } else {
                out += sequence;
            }
            i = j + 1;
            continue;
        }
        out += data.charAt(i);
        i++;
    }
    return out;
}

/** Remove mouse reports and the brackets of pastes from terminal input (for readers that only want text, like Term). */
export function stripMouse(data: string): string {
    if (data.indexOf('\x1b[') < 0) return data;
    let out = '';
    let i = 0;
    while (i < data.length) {
        let paste = pasteAt(data, i);
        if (paste > 0) {
            out += pasteText(data.slice(i, i + paste));
            i += paste;
            continue;
        }
        let length = data.charAt(i) === '\x1b' ? mouseReportAt(data, i) : 0;
        if (length > 0) { i += length; continue; }
        out += data.charAt(i);
        i++;
    }
    return out;
}
