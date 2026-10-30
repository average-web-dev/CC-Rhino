// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/keys.ts — decoding terminal input (the characters and VT sequences a TTY delivers) into Node
// keypress events. Used by the tty streams (process.stdin emits 'keypress') and by readline.emitKeypressEvents.

/** The names of the keys in Node key objects (`key.name`), so code compares against constants, not strings. */
export const KeyName = {
    UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right',
    HOME: 'home', END: 'end', PAGE_UP: 'pageup', PAGE_DOWN: 'pagedown', INSERT: 'insert', DELETE: 'delete',
    CLEAR: 'clear', RETURN: 'return', ENTER: 'enter', TAB: 'tab', BACKSPACE: 'backspace', ESCAPE: 'escape',
    SPACE: 'space',
    F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6', F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11',
    F12: 'f12',
} as const;

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
    /** The xterm button code: 0 left, 1 middle, 2 right, +32 motion, 64/65 scroll; modifiers +4 shift, +8 alt, +16 ctrl. */
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
                code: (code & 3) === 3 ? code & ~3 : code, x: data.charCodeAt(i + 4) - 32, y: data.charCodeAt(i + 5) - 32,
                release: (code & 3) === 3,
            });
        }
        return 6;
    }
    return 0;
}

/**
 * Split terminal input into Node keypress events: emit(sequenceOrUndefined, key). Mouse reports are skipped (they are
 * not keys).
 */
export function decodeKeys(data: string, emit: (s: string | undefined, key: Key) => void): void {
    let i = 0;
    while (i < data.length) {
        let ch = data.charAt(i);
        if (ch === '\x1b') {
            let mouse = mouseReportAt(data, i);
            if (mouse > 0) { i += mouse; continue; }
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
                    emit(undefined, keyFor(KeyName.TAB, sequence, false, false, true));
                } else {
                    emit(undefined, keyFor(CSI_KEYS[code], sequence, (m & 4) !== 0, (m & 2) !== 0, (m & 1) !== 0));
                }
                i = j + 1;
                continue;
            }
            if (next === '') { emit('\x1b', keyFor(KeyName.ESCAPE, '\x1b')); i++; continue; }
            // ESC + key: the key with meta.
            let key = decodeSingle(next);
            key.meta = true;
            key.sequence = '\x1b' + next;
            emit(key.sequence, key);
            i += 2;
            continue;
        }
        emit(ch, decodeSingle(ch));
        i++;
    }
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
