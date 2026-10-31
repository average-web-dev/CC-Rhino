// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/keys.ts — decoding terminal input (the characters and VT sequences a TTY delivers) into Node
// keypress events and mouse events. Used by the tty streams (process.stdin emits 'keypress'),
// readline.emitKeypressEvents, tty.decodeInput and Term.

/** The names of the keys in Node key objects (`key.name`), so code compares against constants, not strings. */
export const KeyName = {
    UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right',
    HOME: 'home', END: 'end', PAGE_UP: 'pageup', PAGE_DOWN: 'pagedown', INSERT: 'insert', DELETE: 'delete',
    CLEAR: 'clear', RETURN: 'return', ENTER: 'enter', TAB: 'tab', BACKSPACE: 'backspace', ESCAPE: 'escape',
    SPACE: 'space',
    F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6', F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11',
    F12: 'f12',
} as const;

/** The kinds of input tty.decodeInput() returns (`input.type`). */
export const InputType = { KEY: 'key', MOUSE: 'mouse' } as const;

/** What a mouse report says happened (`input.action`). */
export const MouseAction = {
    PRESS: 'press', RELEASE: 'release', DRAG: 'drag', MOVE: 'move', SCROLL: 'scroll',
} as const;

/** The mouse buttons (`input.button`). */
export const MouseButton = { LEFT: 'left', MIDDLE: 'middle', RIGHT: 'right' } as const;

function keyFor(name: string | undefined, sequence: string, ctrl = false, meta = false, shift = false): Key {
    return { sequence, name, ctrl, meta, shift };
}

const CSI_KEYS: Record<string, string> = {
    A: KeyName.UP, B: KeyName.DOWN, C: KeyName.RIGHT, D: KeyName.LEFT, H: KeyName.HOME, F: KeyName.END,
    E: KeyName.CLEAR, '1~': KeyName.HOME, '2~': KeyName.INSERT, '3~': KeyName.DELETE, '4~': KeyName.END,
    '5~': KeyName.PAGE_UP, '6~': KeyName.PAGE_DOWN, '7~': KeyName.HOME, '8~': KeyName.END,
    P: KeyName.F1, Q: KeyName.F2, R: KeyName.F3, S: KeyName.F4, '15~': KeyName.F5, '17~': KeyName.F6,
    '18~': KeyName.F7, '19~': KeyName.F8, '20~': KeyName.F9, '21~': KeyName.F10, '23~': KeyName.F11,
    '24~': KeyName.F12,
};

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
        shift: (code & MOUSE_SHIFT) !== 0, meta: (code & MOUSE_ALT) !== 0, ctrl: (code & MOUSE_CTRL) !== 0, sequence,
    };
}

/**
 * Split terminal input into keys and mouse reports: onKey(sequenceOrUndefined, key) gets Node keypress arguments,
 * onMouse the mouse events.
 */
function decode(data: string, onKey: (s: string | undefined, key: Key) => void, onMouse: (mouse: TtyMouseInput) => void): void {
    let i = 0;
    while (i < data.length) {
        let ch = data.charAt(i);
        if (ch === '\x1b') {
            let report: MouseReport | undefined;
            let length = mouseReportAt(data, i, (r) => { report = r; });
            if (length > 0) {
                onMouse(mouseInput(report!, data.slice(i, i + length)));
                i += length;
                continue;
            }
            let next = data.charAt(i + 1);
            if (next === '[' || next === 'O') {
                let j = i + 2;
                let params = '';
                while (j < data.length && /[0-9;]/.test(data.charAt(j))) { params += data.charAt(j); j++; }
                let final = data.charAt(j);
                let sequence = data.slice(i, j + 1);
                let modifier = 1;
                let code: string;
                let parts = params.split(';');
                if (final === '~') {
                    code = parts[0] + '~';
                    if (parts.length > 1) modifier = parseInt(parts[1], 10) || 1;
                } else {
                    code = final;
                    if (parts.length > 1) modifier = parseInt(parts[1], 10) || 1;
                }
                let m = modifier - 1;
                if (final === 'Z') {
                    onKey(undefined, keyFor(KeyName.TAB, sequence, false, false, true));
                } else {
                    onKey(undefined, keyFor(CSI_KEYS[code], sequence, (m & 4) !== 0, (m & 2) !== 0, (m & 1) !== 0));
                }
                i = j + 1;
                continue;
            }
            if (next === '') { onKey('\x1b', keyFor(KeyName.ESCAPE, '\x1b')); i++; continue; }
            // ESC + key: the key with meta.
            let key = decodeSingle(next);
            key.meta = true;
            key.sequence = '\x1b' + next;
            onKey(key.sequence, key);
            i += 2;
            continue;
        }
        onKey(ch, decodeSingle(ch));
        i++;
    }
}

/** Split terminal input into Node keypress events: emit(sequenceOrUndefined, key). Mouse reports are skipped. */
export function decodeKeys(data: string, emit: (s: string | undefined, key: Key) => void): void {
    decode(data, emit, () => {});
}

/** Decode terminal input into keys and mouse events, in order (the counterpart of tty.CSI). */
export function decodeInput(data: string): TtyInput[] {
    let out: TtyInput[] = [];
    decode(data, (_s, key) => { out.push({ type: InputType.KEY, ...key }); }, (mouse) => { out.push(mouse); });
    return out;
}

function decodeSingle(ch: string): Key {
    let code = ch.charCodeAt(0);
    if (ch === '\r') return keyFor(KeyName.RETURN, ch);
    if (ch === '\n') return keyFor(KeyName.ENTER, ch);
    if (ch === '\t') return keyFor(KeyName.TAB, ch);
    if (ch === '\b' || ch === '\x7f') return keyFor(KeyName.BACKSPACE, ch, ch === '\b');
    if (ch === '\x1b') return keyFor(KeyName.ESCAPE, ch);
    if (ch === ' ') return keyFor(KeyName.SPACE, ch);
    if (code > 0 && code <= 26) return keyFor(String.fromCharCode(code + 96), ch, true);
    if (/^[0-9A-Za-z]$/.test(ch)) return keyFor(ch.toLowerCase(), ch, false, false, /^[A-Z]$/.test(ch));
    return keyFor(undefined, ch);
}

/** Remove mouse reports from terminal input (for readers that only want text, like Term). */
export function stripMouse(data: string): string {
    if (data.indexOf('\x1b[') < 0) return data;
    let out = '';
    let i = 0;
    while (i < data.length) {
        let length = data.charAt(i) === '\x1b' ? mouseReportAt(data, i) : 0;
        if (length > 0) { i += length; continue; }
        out += data.charAt(i);
        i++;
    }
    return out;
}
