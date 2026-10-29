// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/readline.ts — a port of Node's readline (lib/internal/readline/interface.js): line input with editing,
// history and tab completion on top of a terminal stream (process.stdin / process.stdout).
//
//   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
//   const name = rl.question('Name? ');          // blocks the calling thread (CC: Rhino's default)
//   rl.question('Name? ', (name) => { … });      // Node's callback form
//   rl.on('line', (line) => { … }); rl.prompt(); // event form; the program keeps running until rl.close()
//
// `require('readline/promises')` has the same Interface with a promise-returning question().
//
// Differences from Node: question() without a callback blocks and returns the answer; an interface ignores input while
// it is paused (process.stdin is shared with the shell); there is no kill ring, undo or reverse search.

import EventEmitter = require('/rom/lib/internal/emitter');
import tty = require('/rom/lib/internal/tty');
import util = require('/rom/lib/util');
import callable = require('/rom/lib/internal/callable');

const asyncMod = require('async');

const kHistorySize = 30;
const kMaxLengthOfKillRing = 32;   // (unused, kept for reference to Node's defaults)
void kMaxLengthOfKillRing;

const lineEnding = /\r?\n|\r(?!\n)/g;

// ── Cursor helpers (module functions in Node) ────────────────────────────────────

function callbackLater(callback: unknown): void {
    if (typeof callback === 'function') require('events').queueMicrotask(() => (callback as (e: null) => void)(null));
}

function cursorTo(stream: Writable | null | undefined, x: number, y?: number | (() => void), callback?: () => void): boolean {
    if (typeof y === 'function') { callback = y; y = undefined; }
    if (Number.isNaN(x)) throw invalidArgValue('x', x);
    if (Number.isNaN(y as number)) throw invalidArgValue('y', y);
    if (stream === null || stream === undefined || (typeof x !== 'number' && typeof y !== 'number')) {
        callbackLater(callback);
        return true;
    }
    return stream.write(tty.CSI.cursorTo(x, y as number | undefined), callback);
}

function moveCursor(stream: Writable | null | undefined, dx: number, dy: number, callback?: () => void): boolean {
    if (stream === null || stream === undefined || !(dx || dy)) {
        callbackLater(callback);
        return true;
    }
    return stream.write(tty.CSI.moveCursor(dx, dy), callback);
}

function clearLine(stream: Writable | null | undefined, dir: number, callback?: () => void): boolean {
    if (stream === null || stream === undefined) {
        callbackLater(callback);
        return true;
    }
    return stream.write(tty.CSI.clearLine(dir), callback);
}

function clearScreenDown(stream: Writable | null | undefined, callback?: () => void): boolean {
    if (stream === null || stream === undefined) {
        callbackLater(callback);
        return true;
    }
    return stream.write(tty.CSI.clearScreenDown, callback);
}

function invalidArgValue(name: string, value: unknown): TypeError {
    let err = new TypeError(`The argument '${name}' is invalid. Received ${util.inspect(value)}`);
    (err as any).code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

// ── Keypress decoding for streams that only emit 'data' ─────────────────────────

const KEYPRESS_DECODER = '__ccKeypressDecoder';

function keyFor(name: string | undefined, sequence: string, ctrl = false, meta = false, shift = false): Key {
    return { sequence, name, ctrl, meta, shift };
}

const CSI_KEYS: Record<string, string> = {
    A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', E: 'clear',
    '1~': 'home', '2~': 'insert', '3~': 'delete', '4~': 'end', '5~': 'pageup', '6~': 'pagedown',
    '7~': 'home', '8~': 'end', P: 'f1', Q: 'f2', R: 'f3', S: 'f4',
    '15~': 'f5', '17~': 'f6', '18~': 'f7', '19~': 'f8', '20~': 'f9', '21~': 'f10', '23~': 'f11', '24~': 'f12',
};

/** Split terminal input (VT sequences) into Node keypress events: emit(sequenceOrUndefined, key). */
function decodeKeys(data: string, emit: (s: string | undefined, key: Key) => void): void {
    let i = 0;
    while (i < data.length) {
        let ch = data.charAt(i);
        if (ch === '\x1b') {
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
            let inner = next;
            let key = decodeSingle(inner);
            key.meta = true;
            key.sequence = '\x1b' + inner;
            emit(key.sequence, key);
            i += 2;
            continue;
        }
        let key = decodeSingle(ch);
        emit(ch, key);
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

/**
 * Make `stream` emit 'keypress' events for its input, as Node's readline.emitKeypressEvents does. process.stdin
 * already emits them (decoded from the computer's key events), so this is a no-op for it.
 */
function emitKeypressEvents(stream: ReadableInput, _iface?: unknown): void {
    if (stream === tty.stdin || (stream as any)[KEYPRESS_DECODER]) return;
    let decoder = (data: string | Uint8Array) => {
        if (stream.listenerCount('keypress') === 0) return;
        let text = typeof data === 'string' ? data : String.fromCharCode.apply(null, Array.prototype.slice.call(data));
        decodeKeys(text, (s, key) => { stream.emit!('keypress', s, key); });
    };
    Object.defineProperty(stream, KEYPRESS_DECODER, { value: decoder, configurable: true });
    stream.on('data', decoder);
}

// ── Interface ────────────────────────────────────────────────────────────────────

/** The class below (`Interface` is also the global type of readline interfaces). */
type InterfaceImpl = Interface;

function useAfterClose(): Error {
    let err = new Error('readline was closed');
    (err as any).code = 'ERR_USE_AFTER_CLOSE';
    return err;
}

function setRawMode(self: InterfaceImpl, mode: boolean): boolean | undefined {
    let wasRaw = self.input.isRaw;
    if (typeof self.input.setRawMode === 'function') self.input.setRawMode(mode);
    return wasRaw;
}

function writeToOutput(self: InterfaceImpl, text: string): void {
    if (self.output !== null && self.output !== undefined) self.output.write(text);
}

function columns(self: InterfaceImpl): number {
    let output = self.output;
    if (output && typeof output.columns === 'number' && output.columns > 0) return output.columns;
    return Infinity;
}

/** Rows and columns a string occupies when written from the start of a row (Node's _getDisplayPos). */
function displayPos(self: InterfaceImpl, str: string): CursorPos {
    let offset = 0;
    let col = columns(self);
    let rows = 0;
    str = util.stripVTControlCharacters(str);
    for (let i = 0; i < str.length; i++) {
        let ch = str.charAt(i);
        if (ch === '\n') {
            rows += Math.ceil(offset / col) || 1;
            offset = 0;
            continue;
        }
        if (ch === '\t') {
            offset += self.tabSize - (offset % self.tabSize);
            continue;
        }
        offset += 1;
    }
    let cols = offset % col;
    rows += (offset - cols) / col;
    return { cols, rows };
}

function cursorPos(self: InterfaceImpl): CursorPos {
    return displayPos(self, self._prompt + self.line.slice(0, self.cursor));
}

function refreshLine(self: InterfaceImpl): void {
    let line = self._prompt + self.line;
    let dispPos = displayPos(self, line);
    let lineCols = dispPos.cols;
    let lineRows = dispPos.rows;
    let pos = cursorPos(self);

    let prevRows = self.prevRows || 0;
    if (prevRows > 0) moveCursor(self.output, 0, -prevRows);
    cursorTo(self.output, 0);
    clearScreenDown(self.output);
    writeToOutput(self, line);
    // Make the terminal allocate the next row when the line exactly fills the last one.
    if (lineCols === 0) writeToOutput(self, ' ');
    cursorTo(self.output, pos.cols);
    let diff = lineRows - pos.rows;
    if (diff > 0) moveCursor(self.output, 0, -diff);
    self.prevRows = pos.rows;
}

function insertString(self: InterfaceImpl, c: string): void {
    if (c === '') return;
    if (self.cursor < self.line.length) {
        self.line = self.line.slice(0, self.cursor) + c + self.line.slice(self.cursor);
        self.cursor += c.length;
        refreshLine(self);
    } else {
        let oldPos = cursorPos(self);
        self.line += c;
        self.cursor += c.length;
        let newPos = cursorPos(self);
        if (oldPos.rows < newPos.rows) refreshLine(self);
        else writeToOutput(self, c);
    }
}

function moveCursorBy(self: InterfaceImpl, dx: number): void {
    if (dx === 0) return;
    let oldPos = cursorPos(self);
    self.cursor += dx;
    if (self.cursor < 0) self.cursor = 0;
    else if (self.cursor > self.line.length) self.cursor = self.line.length;
    let newPos = cursorPos(self);
    if (oldPos.rows === newPos.rows) moveCursor(self.output, newPos.cols - oldPos.cols, 0);
    else refreshLine(self);
}

function reverse(str: string): string {
    return str.split('').reverse().join('');
}

function wordLeft(self: InterfaceImpl): void {
    if (self.cursor > 0) {
        let match = /^\s*(?:[^\w\s]+|\w+)?/.exec(reverse(self.line.slice(0, self.cursor)));
        moveCursorBy(self, -(match ? match[0].length : 0));
    }
}

function wordRight(self: InterfaceImpl): void {
    if (self.cursor < self.line.length) {
        let match = /^(?:\s+|[^\w\s]+|\w+)\s*/.exec(self.line.slice(self.cursor));
        moveCursorBy(self, match ? match[0].length : 0);
    }
}

function deleteLeft(self: InterfaceImpl): void {
    if (self.cursor > 0 && self.line.length > 0) {
        self.line = self.line.slice(0, self.cursor - 1) + self.line.slice(self.cursor);
        self.cursor -= 1;
        refreshLine(self);
    }
}

function deleteRight(self: InterfaceImpl): void {
    if (self.cursor < self.line.length) {
        self.line = self.line.slice(0, self.cursor) + self.line.slice(self.cursor + 1);
        refreshLine(self);
    }
}

function deleteWordLeft(self: InterfaceImpl): void {
    if (self.cursor > 0) {
        let leading = self.line.slice(0, self.cursor);
        let match = /^\s*(?:[^\w\s]+|\w+)?/.exec(reverse(leading));
        leading = leading.slice(0, leading.length - (match ? match[0].length : 0));
        self.line = leading + self.line.slice(self.cursor);
        self.cursor = leading.length;
        refreshLine(self);
    }
}

function deleteWordRight(self: InterfaceImpl): void {
    if (self.cursor < self.line.length) {
        let trailing = self.line.slice(self.cursor);
        let match = /^(?:\s+|\W+|\w+)\s*/.exec(trailing);
        self.line = self.line.slice(0, self.cursor) + trailing.slice(match ? match[0].length : 0);
        refreshLine(self);
    }
}

function deleteLineLeft(self: InterfaceImpl): void {
    self.line = self.line.slice(self.cursor);
    self.cursor = 0;
    refreshLine(self);
}

function deleteLineRight(self: InterfaceImpl): void {
    self.line = self.line.slice(0, self.cursor);
    refreshLine(self);
}

function addHistory(self: InterfaceImpl): string {
    if (self.line.length === 0) return '';
    if (self.historySize === 0) return self.line;
    if (self.line.trim().length === 0) return self.line;
    if (self.history.length === 0 || self.history[0] !== self.line) {
        if (self.removeHistoryDuplicates) {
            let dupIndex = self.history.indexOf(self.line);
            if (dupIndex !== -1) self.history.splice(dupIndex, 1);
        }
        self.history.unshift(self.line);
        if (self.history.length > self.historySize) self.history.pop();
    }
    self.historyIndex = -1;
    // A 'history' listener may change the history (e.g. drop a password), so return what it holds now.
    let line = self.history[0];
    self.emit('history', self.history);
    return line;
}

/** Up: the previous history entry starting with what was typed before browsing (Node's substring search). */
function historyPrev(self: InterfaceImpl): void {
    if (self.historyIndex < self.history.length && self.history.length) {
        let search = self._substringSearch || '';
        let index = self.historyIndex + 1;
        while (index < self.history.length &&
            (!self.history[index].startsWith(search) || self.line === self.history[index])) {
            index++;
        }
        self.line = index === self.history.length ? search : self.history[index];
        self.historyIndex = index;
        self.cursor = self.line.length;
        refreshLine(self);
    }
}

function historyNext(self: InterfaceImpl): void {
    if (self.historyIndex >= 0) {
        let search = self._substringSearch || '';
        let index = self.historyIndex - 1;
        while (index >= 0 && (!self.history[index].startsWith(search) || self.line === self.history[index])) {
            index--;
        }
        self.line = index === -1 ? search : self.history[index];
        self.historyIndex = index;
        self.cursor = self.line.length;
        refreshLine(self);
    }
}

function onLine(self: InterfaceImpl, line: string): void {
    let callback = self._questionCallback;
    if (callback !== null) {
        self._questionCallback = null;
        self._questionCancel = null;
        self.setPrompt(self._oldPrompt);
        callback(line);
    } else {
        self.emit('line', line);
    }
}

function acceptLine(self: InterfaceImpl): void {
    let line = addHistory(self);
    self.clearLine();
    onLine(self, line);
}

function normalWrite(self: InterfaceImpl, text: string): void {
    if (text === '') return;
    // A \r\n split across two chunks is one line ending.
    if (self._sawReturnAt !== 0 && Date.now() - self._sawReturnAt <= self.crlfDelay && text.charAt(0) === '\n') {
        text = text.slice(1);
    }
    self._sawReturnAt = text.charAt(text.length - 1) === '\r' ? Date.now() : 0;
    let lines = (self._lineBuffer + text).split(lineEnding);
    self._lineBuffer = lines.pop() as string;
    for (let line of lines) onLine(self, line);
}

function commonPrefix(strings: string[]): string {
    if (strings.length === 0) return '';
    let prefix = strings[0];
    for (let s of strings) {
        let i = 0;
        while (i < prefix.length && prefix.charAt(i) === s.charAt(i)) i++;
        prefix = prefix.slice(0, i);
        if (prefix === '') break;
    }
    return prefix;
}

function tabComplete(self: InterfaceImpl, lastKeypressWasTab: boolean): void {
    let completer = self.completer as Completer;
    let text = self.line.slice(0, self.cursor);
    let apply = (value: CompleterResult | undefined) => {
        if (value === undefined || value === null) return;
        tabCompleter(self, lastKeypressWasTab, value);
    };
    if (completer.length === 2) {
        // Node's callback form: completer(line, (err, result) => …).
        (completer as (line: string, cb: (err: Error | null, result?: CompleterResult) => void) => void)(text, (err, result) => {
            if (err) { writeToOutput(self, `\r\nTab completion error: ${util.inspect(err)}\r\n`); refreshLine(self); return; }
            apply(result);
        });
        return;
    }
    let value: CompleterResult | Promise<CompleterResult>;
    try {
        value = (completer as (line: string) => CompleterResult | Promise<CompleterResult>)(text);
    } catch (err) {
        writeToOutput(self, `\r\nTab completion error: ${util.inspect(err)}\r\n`);
        refreshLine(self);
        return;
    }
    if (value !== null && typeof value === 'object' && typeof (value as Promise<CompleterResult>).then === 'function') {
        (value as Promise<CompleterResult>).then(apply, (err) => {
            writeToOutput(self, `\r\nTab completion error: ${util.inspect(err)}\r\n`);
            refreshLine(self);
        });
    } else {
        apply(value as CompleterResult);
    }
}

function tabCompleter(self: InterfaceImpl, lastKeypressWasTab: boolean, result: CompleterResult): void {
    let completions = result[0];
    let completeOn = result[1];
    if (!completions || completions.length === 0) return;

    let nonEmpty: string[] = [];
    for (let c of completions) if (c !== '') nonEmpty.push(c);
    let prefix = commonPrefix(nonEmpty);
    if (prefix.startsWith(completeOn) && prefix.length > completeOn.length) {
        insertString(self, prefix.slice(completeOn.length));
        return;
    } else if (!completeOn.startsWith(prefix)) {
        self.line = self.line.slice(0, self.cursor - completeOn.length) + prefix + self.line.slice(self.cursor);
        self.cursor = self.cursor - completeOn.length + prefix.length;
        refreshLine(self);
        return;
    }
    if (!lastKeypressWasTab) return;

    // Second Tab: list the candidates in columns below the line, then redraw it.
    let maxWidth = 0;
    for (let c of completions) if (c.length > maxWidth) maxWidth = c.length;
    let width = maxWidth + 2;
    let maxColumns = Math.floor(columns(self) / width) || 1;
    if (maxColumns === Infinity) maxColumns = 1;
    let output = '\r\n';
    let lineIndex = 0;
    let whitespace = 0;
    for (let i = 0; i < completions.length; i++) {
        let completion = completions[i];
        if (completion === '' || lineIndex === maxColumns) {
            output += '\r\n';
            lineIndex = 0;
            whitespace = 0;
        } else {
            output += ' '.repeat(whitespace);
        }
        if (completion !== '') {
            output += completion;
            whitespace = width - completion.length;
            lineIndex++;
        } else {
            output += '\r\n';
        }
    }
    if (lineIndex !== 0) output += '\r\n\r\n';
    // Move below the edited line first, so a line spanning several rows is not overwritten.
    moveCursorBy(self, Infinity);
    writeToOutput(self, output);
    self.prevRows = 0;
    refreshLine(self);
}

function ttyWrite(self: InterfaceImpl, s: string | undefined, key: Key | undefined): void {
    let previousKey = self._previousKey;
    key = key || ({} as Key);
    self._previousKey = key;

    if ((key.name === 'up' || key.name === 'down') && !key.ctrl && !key.meta && !key.shift) {
        if (self._substringSearch === null) self._substringSearch = self.line.slice(0, self.cursor);
    } else if (self._substringSearch !== null) {
        self._substringSearch = null;
        if (self.history.length === self.historyIndex) self.historyIndex = -1;
    }

    if (key.name === 'escape') return;

    if (key.ctrl && key.shift) {
        switch (key.name) {
            case 'backspace': deleteLineLeft(self); break;
            case 'delete': deleteLineRight(self); break;
        }
    } else if (key.ctrl) {
        switch (key.name) {
            case 'c':
                if (self.listenerCount('SIGINT') > 0) self.emit('SIGINT');
                else self.close();
                break;
            case 'h': deleteLeft(self); break;
            case 'd':
                if (self.cursor === 0 && self.line.length === 0) self.close();
                else if (self.cursor < self.line.length) deleteRight(self);
                break;
            case 'u': deleteLineLeft(self); break;
            case 'k': deleteLineRight(self); break;
            case 'a': moveCursorBy(self, -Infinity); break;
            case 'e': moveCursorBy(self, Infinity); break;
            case 'b': moveCursorBy(self, -1); break;
            case 'f': moveCursorBy(self, 1); break;
            case 'l':
                cursorTo(self.output, 0, 0);
                clearScreenDown(self.output);
                self.prevRows = 0;
                refreshLine(self);
                break;
            case 'n': historyNext(self); break;
            case 'p': historyPrev(self); break;
            case 'w': case 'backspace': deleteWordLeft(self); break;
            case 'delete': deleteWordRight(self); break;
            case 'left': wordLeft(self); break;
            case 'right': wordRight(self); break;
        }
    } else if (key.meta) {
        switch (key.name) {
            case 'b': case 'left': wordLeft(self); break;
            case 'f': case 'right': wordRight(self); break;
            case 'd': case 'delete': deleteWordRight(self); break;
            case 'backspace': deleteWordLeft(self); break;
        }
    } else {
        if (self._sawReturnAt && key.name !== 'enter') self._sawReturnAt = 0;
        switch (key.name) {
            case 'return':
                self._sawReturnAt = Date.now();
                acceptLine(self);
                break;
            case 'enter':
                // \r\n counts as one line ending.
                if (self._sawReturnAt === 0 || Date.now() - self._sawReturnAt > self.crlfDelay) acceptLine(self);
                self._sawReturnAt = 0;
                break;
            case 'backspace': deleteLeft(self); break;
            case 'delete': deleteRight(self); break;
            case 'left': moveCursorBy(self, -1); break;
            case 'right': moveCursorBy(self, 1); break;
            case 'home': moveCursorBy(self, -Infinity); break;
            case 'end': moveCursorBy(self, Infinity); break;
            case 'up': historyPrev(self); break;
            case 'down': historyNext(self); break;
            case 'tab':
                if (typeof self.completer === 'function' && self.isCompletionEnabled) {
                    tabComplete(self, previousKey !== null && previousKey.name === 'tab');
                    break;
                }
            // falls through
            default:
                if (typeof s === 'string' && s) {
                    lineEnding.lastIndex = 0;
                    let lastIndex = 0;
                    let match: RegExpExecArray | null;
                    while ((match = lineEnding.exec(s)) !== null) {
                        insertString(self, s.slice(lastIndex, match.index));
                        lastIndex = lineEnding.lastIndex;
                        acceptLine(self);
                        lineEnding.lastIndex = lastIndex;
                    }
                    insertString(self, s.slice(lastIndex));
                }
        }
    }
}

function askQuestion(self: InterfaceImpl, query: string, callback: (answer: string) => void,
                     cancel: ((reason: Error) => void) | null): void {
    if (self._questionCallback !== null) {
        self.prompt();
        return;
    }
    self._oldPrompt = self._prompt;
    self.setPrompt(query);
    self._questionCallback = callback;
    self._questionCancel = cancel;
    self.prompt();
}

class Interface extends EventEmitter {
    declare input: ReadableInput;
    declare output: Writable | null | undefined;
    declare completer: Completer | undefined;
    declare history: string[];
    declare historySize: number;
    declare removeHistoryDuplicates: boolean;
    declare crlfDelay: number;
    declare tabSize: number;
    declare terminal: boolean;
    declare line: string;
    declare cursor: number;
    declare historyIndex: number;
    declare closed: boolean;
    declare paused: boolean;
    declare isCompletionEnabled: boolean;
    declare _prompt: string;
    declare _oldPrompt: string;
    declare _questionCallback: ((answer: string) => void) | null;
    declare _questionCancel: ((reason: Error) => void) | null;
    declare _substringSearch: string | null;
    declare _previousKey: Key | null;
    declare _sawReturnAt: number;
    declare _lineBuffer: string;
    declare _listeners: { event: string; fn: (...args: any[]) => void; target: 'input' | 'output' }[];
    declare prevRows: number;

    constructor(input: ReadableInput | InterfaceOptions, output?: Writable | null, completer?: Completer, terminal?: boolean) {
        super();

        let history: string[] | undefined;
        let historySize: number | undefined;
        let removeHistoryDuplicates = false;
        let prompt = '> ';
        let crlfDelay: number | undefined;
        let tabSize = 8;

        if (input !== null && typeof input === 'object' && (input as InterfaceOptions).input !== undefined) {
            let options = input as InterfaceOptions;
            output = options.output;
            completer = options.completer;
            terminal = options.terminal;
            history = options.history;
            historySize = options.historySize;
            removeHistoryDuplicates = !!options.removeHistoryDuplicates;
            if (options.prompt !== undefined) prompt = options.prompt;
            crlfDelay = options.crlfDelay;
            if (options.tabSize !== undefined) tabSize = options.tabSize;
            input = options.input;
        }
        let inputStream = input as ReadableInput;
        if (inputStream === null || inputStream === undefined || typeof inputStream.on !== 'function') {
            let err = new TypeError('The "input" argument must be a readable stream');
            (err as any).code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (completer !== undefined && typeof completer !== 'function') throw invalidArgValue('completer', completer);
        if (history === undefined) history = [];
        if (historySize === undefined) historySize = kHistorySize;
        if (typeof historySize !== 'number' || Number.isNaN(historySize) || historySize < 0) {
            let err = new RangeError('The value of "historySize" is out of range. It must be a non-negative number');
            (err as any).code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        if (terminal === undefined && output !== null && output !== undefined) terminal = !!output.isTTY;

        this.input = inputStream;
        this.output = output;
        this.completer = completer;
        this.history = history;
        this.historySize = historySize;
        this.removeHistoryDuplicates = removeHistoryDuplicates;
        this.crlfDelay = crlfDelay ? Math.max(100, crlfDelay) : 100;
        this.tabSize = tabSize;
        this.terminal = !!terminal;
        this.line = '';
        this.cursor = 0;
        this.historyIndex = -1;
        this.closed = false;
        this.paused = false;
        this.isCompletionEnabled = true;
        this._prompt = prompt;
        this._oldPrompt = '';
        this._questionCallback = null;
        this._questionCancel = null;
        this._substringSearch = null;
        this._previousKey = null;
        this._sawReturnAt = 0;
        this._lineBuffer = '';
        this._listeners = [];
        this.prevRows = 0;

        let self = this;
        let listen = (target: 'input' | 'output', event: string, fn: (...args: any[]) => void) => {
            self._listeners.push({ event, fn, target });
            if (target === 'input') inputStream.on(event, fn); else (output as Writable).on!(event, fn);
        };

        if (!this.terminal) {
            listen('input', 'data', (data: string | Uint8Array) => {
                if (self.paused) return;
                normalWrite(self, typeof data === 'string' ? data : String.fromCharCode.apply(null, Array.prototype.slice.call(data)));
            });
            listen('input', 'end', () => {
                if (self._lineBuffer.length > 0) {
                    let line = self._lineBuffer;
                    self._lineBuffer = '';
                    onLine(self, line);
                }
                self.close();
            });
        } else {
            emitKeypressEvents(inputStream, this);
            listen('input', 'keypress', (s: string | undefined, key: Key) => {
                // process.stdin is shared with the shell: an interface that is paused does not take part.
                if (self.paused || self.closed) return;
                ttyWrite(self, s, key);
            });
            listen('input', 'end', () => { self.close(); });
            setRawMode(this, true);
            if (output !== null && output !== undefined && typeof output.on === 'function') {
                listen('output', 'resize', () => { refreshLine(self); });
            }
        }

        if (typeof inputStream.resume === 'function') inputStream.resume();
    }

    setPrompt(prompt: string): void { this._prompt = prompt; }
    getPrompt(): string { return this._prompt; }

    prompt(preserveCursor?: boolean): void {
        if (this.closed) throw useAfterClose();
        if (this.paused) this.resume();
        if (this.terminal) {
            if (!preserveCursor) this.cursor = 0;
            refreshLine(this);
        } else {
            writeToOutput(this, this._prompt);
        }
    }

    question(query: string, callback: (answer: string) => void): void;
    question(query: string, options: object, callback: (answer: string) => void): void;
    question(query: string, options?: object): string;
    question(query: string, options?: unknown, callback?: (answer: string) => void): string | void {
        if (typeof options === 'function') { callback = options as (answer: string) => void; options = undefined; }
        if (this.closed) throw useAfterClose();
        if (typeof callback === 'function') {
            askQuestion(this, query, callback, null);
            return;
        }
        // No callback: block the calling thread until the answer arrives (CC: Rhino's blocking default).
        let self = this;
        let answer = new Promise<string>((resolve, reject) => askQuestion(self, query, resolve, reject));
        return asyncMod.unwrap(answer);
    }

    pause(): this {
        if (this.paused) return this;
        if (typeof this.input.pause === 'function') this.input.pause();
        this.paused = true;
        this.emit('pause');
        return this;
    }

    resume(): this {
        if (!this.paused) return this;
        if (typeof this.input.resume === 'function') this.input.resume();
        this.paused = false;
        this.emit('resume');
        return this;
    }

    write(data: string | null | undefined, key?: Partial<Key>): void {
        if (this.closed) throw useAfterClose();
        if (this.paused) this.resume();
        if (this.terminal) ttyWrite(this, data === null ? undefined : data, key as Key | undefined);
        else if (typeof data === 'string') normalWrite(this, data);
    }

    clearLine(): void {
        moveCursorBy(this, Infinity);
        writeToOutput(this, '\r\n');
        this.line = '';
        this.cursor = 0;
        this.prevRows = 0;
    }

    getCursorPos(): CursorPos { return cursorPos(this); }

    close(): void {
        if (this.closed) return;
        this.pause();
        if (this.terminal) setRawMode(this, false);
        for (let l of this._listeners) {
            if (l.target === 'input') this.input.removeListener(l.event, l.fn);
            else if (this.output && typeof this.output.removeListener === 'function') this.output.removeListener(l.event, l.fn);
        }
        this._listeners = [];
        this.closed = true;
        let cancel = this._questionCancel;
        this._questionCallback = null;
        this._questionCancel = null;
        if (cancel !== null) {
            let err = new Error('The question was aborted, as the interface was closed');
            err.name = 'AbortError';
            (err as any).code = 'ABORT_ERR';
            cancel(err);
        }
        this.emit('close');
    }

    get columns(): number {
        return columns(this);
    }

    /** `for await (const line of rl)`: the lines, ending when the interface closes. */
    [Symbol.asyncIterator](): AsyncIterableIterator<string> {
        let self = this;
        let queue: string[] = [];
        let waiting: ((result: IteratorResult<string>) => void)[] = [];
        let done = this.closed;
        let onLineEvent = (line: string) => {
            let next = waiting.shift();
            if (next !== undefined) next({ value: line, done: false }); else queue.push(line);
        };
        let onClose = () => {
            done = true;
            while (waiting.length > 0) (waiting.shift() as (r: IteratorResult<string>) => void)({ value: undefined, done: true });
        };
        this.on('line', onLineEvent);
        this.on('close', onClose);
        let iterator: AsyncIterableIterator<string> = {
            next(): Promise<IteratorResult<string>> {
                if (queue.length > 0) return Promise.resolve({ value: queue.shift() as string, done: false });
                if (done) return Promise.resolve({ value: undefined, done: true });
                return new Promise((resolve) => { waiting.push(resolve); });
            },
            return(): Promise<IteratorResult<string>> {
                self.off('line', onLineEvent);
                self.off('close', onClose);
                self.close();
                return Promise.resolve({ value: undefined, done: true });
            },
            [Symbol.asyncIterator]() { return iterator; },
        };
        return iterator;
    }
}

// Like Node's readline.Interface, it also works without `new`.
const PublicInterface = callable(Interface) as unknown as InterfaceConstructor;

function createInterface(input: ReadableInput | InterfaceOptions, output?: Writable | null, completer?: Completer,
                         terminal?: boolean): Interface {
    return new Interface(input as any, output, completer, terminal);
}

const readline: ReadlineModule = {
    Interface: PublicInterface,
    createInterface,
    clearLine,
    clearScreenDown,
    cursorTo,
    moveCursor,
    emitKeypressEvents,
} as unknown as ReadlineModule;

// readline.promises, loaded lazily: readline/promises itself builds on this module.
Object.defineProperty(readline, 'promises', {
    get() { return require('readline/promises'); },
    enumerable: true,
    configurable: true,
});

export = readline;
