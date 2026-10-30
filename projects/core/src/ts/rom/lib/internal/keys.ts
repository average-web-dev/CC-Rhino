// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/keys.ts — decoding terminal input (the characters and VT sequences a TTY delivers) into Node
// keypress events. Used by the tty streams (process.stdin emits 'keypress') and by readline.emitKeypressEvents.

function keyFor(name: string | undefined, sequence: string, ctrl = false, meta = false, shift = false): Key {
    return { sequence, name, ctrl, meta, shift };
}

const CSI_KEYS: Record<string, string> = {
    A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', E: 'clear',
    '1~': 'home', '2~': 'insert', '3~': 'delete', '4~': 'end', '5~': 'pageup', '6~': 'pagedown',
    '7~': 'home', '8~': 'end', P: 'f1', Q: 'f2', R: 'f3', S: 'f4',
    '15~': 'f5', '17~': 'f6', '18~': 'f7', '19~': 'f8', '20~': 'f9', '21~': 'f10', '23~': 'f11', '24~': 'f12',
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
                    emit(undefined, keyFor('tab', sequence, false, false, true));
                } else {
                    emit(undefined, keyFor(CSI_KEYS[code], sequence, (m & 4) !== 0, (m & 2) !== 0, (m & 1) !== 0));
                }
                i = j + 1;
                continue;
            }
            if (next === '') { emit('\x1b', keyFor('escape', '\x1b')); i++; continue; }
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
    if (ch === '\r') return keyFor('return', ch);
    if (ch === '\n') return keyFor('enter', ch);
    if (ch === '\t') return keyFor('tab', ch);
    if (ch === '\b' || ch === '\x7f') return keyFor('backspace', ch, ch === '\b');
    if (ch === '\x1b') return keyFor('escape', ch);
    if (ch === ' ') return keyFor('space', ch);
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
