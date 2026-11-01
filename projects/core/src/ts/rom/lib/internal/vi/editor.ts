// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/editor.ts — the state of the vi editor and what keys do to it, without any terminal: /rom/bin/vi
// feeds it the decoded input and draws it with ./view.ts, and the tests drive it directly. Normal mode (commands,
// motions, operators) is ./normal.ts; Insert, Replace and the command line are here.
//
// Keys are named as in vim's documentation: a typed character is itself ('a', 'A', ':'), others are '<Esc>', '<CR>',
// '<BS>', '<Del>', '<Tab>', '<Up>' …, with Ctrl '<C-r>' / '<C-Left>', with Shift '<S-Left>'.

import { TextBuffer, type Position } from '/rom/lib/internal/vi/buffer';
import { Key } from '/rom/lib/internal/keys';
import { execute } from '/rom/lib/internal/vi/ex';
import { firstNonBlank, runMotion } from '/rom/lib/internal/vi/motions';
import { NormalMode } from '/rom/lib/internal/vi/normal';
import { Registers } from '/rom/lib/internal/vi/registers';
import { colAtDisplay, displayCol } from '/rom/lib/internal/vi/tabs';

export type Mode = 'normal' | 'insert' | 'replace' | 'command';

/** How the editor reads and writes files (fs in vi; a map in the tests). */
export interface FileIO {
    /** The file's text, or undefined if it does not exist. Throws if it cannot be read. */
    read(path: string): string | undefined;
    /** Write the file; throws if it cannot be written. */
    write(path: string, text: string): void;
}

const NAMED_KEYS: Record<string, string> = {
    [Key.ESCAPE]: 'Esc', [Key.ENTER]: 'CR', [Key.NUMPAD_ENTER]: 'CR', [Key.BACKSPACE]: 'BS', [Key.DELETE]: 'Del',
    [Key.TAB]: 'Tab', [Key.ARROW_UP]: 'Up', [Key.ARROW_DOWN]: 'Down', [Key.ARROW_LEFT]: 'Left',
    [Key.ARROW_RIGHT]: 'Right', [Key.HOME]: 'Home', [Key.END]: 'End', [Key.PAGE_UP]: 'PageUp',
    [Key.PAGE_DOWN]: 'PageDown', [Key.INSERT]: 'Insert',
};

/** Keys that keep their Ctrl / Shift in their name ('<C-Left>'); for the others the modifier means nothing to vi. */
const MODIFIED_KEYS = new Set(['Up', 'Down', 'Left', 'Right', 'Home', 'End']);

/** The vim name of a key press ('a', '<Esc>', '<C-r>'), or undefined for keys vi ignores (a modifier alone, F13). */
export function keyName(key: TtyKeyInput): string | undefined {
    let named = NAMED_KEYS[key.code];
    if (named !== undefined) {
        if (MODIFIED_KEYS.has(named) && key.ctrlKey) return `<C-${named}>`;
        if (MODIFIED_KEYS.has(named) && key.shiftKey) return `<S-${named}>`;
        return `<${named}>`;
    }
    if (key.ctrlKey && /^Key[A-Z]$/.test(key.code)) return `<C-${key.code.charAt(3).toLowerCase()}>`;
    if (key.ctrlKey || key.altKey || key.metaKey) return undefined;
    return Array.from(key.key).length === 1 ? key.key : undefined;
}

/** Whether `name` is a key that types itself (a character, not '<…>'). */
export function isCharKey(name: string): boolean {
    return Array.from(name).length === 1;
}

/** What an Insert or Replace session typed, so that a count can repeat it (3ix<Esc> inserts "xxx"). */
interface InsertSession {
    count: number;
    /** Text put before each repetition (o and O start a new line each time). */
    prefix: string;
    /** The text typed (Backspace takes it back again). */
    typed: string;
}

export class Editor {
    readonly buffer: TextBuffer;
    readonly registers = new Registers();
    /** The file being edited (undefined: none yet, `:w name` sets it). */
    path: string | undefined;
    cursor: Position = { line: 0, col: 0 };
    mode: Mode = 'normal';
    /** The command line being typed after ':'. */
    command = '';
    /** The message shown on the last row (until the next key), and whether it is an error. */
    message = '';
    error = false;
    /** Set when the editor should close. */
    quit = false;
    /** The first line and the first screen column shown, and the size of the text area. */
    top = 0;
    left = 0;
    width = 51;
    rows = 18;
    /** The screen column vertical moves aim for ('end' after '$': the end of every line). */
    want: number | 'end' = 0;
    /** The last f / t / F / T, for ; and ,. */
    lastFind: { motion: string; char: string } | undefined;

    readonly #io: FileIO;
    readonly #normal: NormalMode;
    #insert: InsertSession | undefined;
    /** In Replace mode: the characters overwritten, so that Backspace can restore them ('' for appended ones). */
    #replaced: string[] = [];

    constructor(io: FileIO, path?: string) {
        this.#io = io;
        this.path = path;
        let text: string | undefined;
        if (path !== undefined) {
            try {
                text = io.read(path);
                this.message = text === undefined ? `"${path}" [New]` : `"${path}" ${describe(text)}`;
            } catch (e) {
                this.message = `"${path}" ${errorText(e)}`;
                this.error = true;
            }
        }
        // The line break ending the file is no line of its own; it is written back (vim's 'fixendofline').
        if (text !== undefined && text.endsWith('\n')) text = text.slice(0, -1);
        this.buffer = new TextBuffer(text ?? '');
        this.buffer.markSaved();
        this.#normal = new NormalMode(this);
    }

    /** The keys of a Normal-mode command typed so far (shown at the bottom, like vim's 'showcmd'). */
    get pendingKeys(): string {
        return this.#normal.pending;
    }

    /** The size of the text area (the screen without the last row). */
    setSize(width: number, rows: number): void {
        this.width = Math.max(1, width);
        this.rows = Math.max(1, rows);
        this.follow();
    }

    /** Scroll so that the cursor is shown. */
    follow(): void {
        let line = this.cursor.line;
        if (line < this.top) this.top = line;
        else if (line >= this.top + this.rows) this.top = line - this.rows + 1;
        this.top = Math.max(0, Math.min(this.top, this.buffer.lineCount - 1));
        let x = displayCol(this.buffer.line(line), this.cursor.col);
        if (x < this.left) this.left = x;
        else if (x >= this.left + this.width) this.left = x - this.width + 1;
    }

    // ── Input ────────────────────────────────────────────────────────────────────────────────────────────────────────

    handleKey(key: TtyKeyInput): void {
        let name = keyName(key);
        if (name !== undefined) this.feed(name);
    }

    /** Pasted text: inserted at the cursor as it is (one undo step), in Normal mode too. */
    handlePaste(text: string): void {
        if (this.mode === 'command') {
            this.command += text.replace(/[\r\n]/g, ' ');
            return;
        }
        let body = text.replace(/\r\n?/g, '\n');
        if (this.mode === 'insert' || this.mode === 'replace') {
            this.cursor = this.buffer.insert(this.cursor, body, this.cursor);
            if (this.#insert !== undefined) this.#insert.typed += body;
            // '.' repeats it as typed.
            for (let ch of body) this.#normal.record(ch === '\n' ? '<CR>' : ch);
        } else {
            this.buffer.begin(this.cursor);
            let end = this.buffer.insert(this.cursor, body, this.cursor);
            this.cursor = this.normalCol({ line: end.line, col: end.col - 1 });
            this.buffer.end(this.cursor);
        }
        this.wantHere();
        this.follow();
    }

    /** One key, by its vim name. */
    feed(name: string): void {
        if (this.mode !== 'command') { this.message = ''; this.error = false; }
        if (this.mode === 'insert' || this.mode === 'replace') this.#normal.record(name);
        switch (this.mode) {
            case 'normal': this.#normal.feed(name); break;
            case 'insert': case 'replace': this.#insertKey(name); break;
            case 'command': this.#commandLine(name); break;
        }
        this.follow();
    }

    /** Show an error message (a command failed). */
    fail(message: string): void {
        this.message = message;
        this.error = true;
    }

    /** Write the text to `path` (default: the file being edited); false (with a message) if it failed. */
    write(path = this.path): boolean {
        if (path === undefined) { this.fail('E32: No file name'); return false; }
        let text = this.buffer.text();
        if (!(this.buffer.lineCount === 1 && text === '')) text += '\n';
        try {
            this.#io.write(path, text);
        } catch (e) {
            this.fail(`"${path}" ${errorText(e)}`);
            return false;
        }
        if (this.path === undefined) this.path = path;
        if (path === this.path) this.buffer.markSaved();
        this.message = `"${path}" ${describe(text)} written`;
        return true;
    }

    /** Move the cursor to line `line` (from 0), on its first non-blank character. */
    gotoLine(line: number): void {
        let target = Math.max(0, Math.min(line, this.buffer.lineCount - 1));
        this.cursor = { line: target, col: firstNonBlank(this.buffer.line(target)) };
        this.wantHere();
    }

    // ── Helpers for the modes ────────────────────────────────────────────────────────────────────────────────────────

    /** `pos` clamped for Normal mode: the cursor sits on a character, not after the last one. */
    normalCol(pos: Position): Position {
        let clamped = this.buffer.clamp(pos);
        let length = this.buffer.line(clamped.line).length;
        return { line: clamped.line, col: Math.max(0, Math.min(clamped.col, length - 1)) };
    }

    /** Vertical moves aim for the cursor's current screen column from now on. */
    wantHere(): void {
        this.want = displayCol(this.buffer.line(this.cursor.line), this.cursor.col);
    }

    /** The column of `line` vertical moves land on. */
    wantedCol(line: number): number {
        let text = this.buffer.line(line);
        return this.want === 'end' ? text.length : colAtDisplay(text, this.want);
    }

    /**
     * Enter Insert (or Replace) mode with the cursor at `at`. The undo step started before the command (o, c …) goes on
     * until Esc; `count` and `prefix` say how Esc repeats the typed text (3ix, 2o).
     */
    startInsert(at: Position, mode: 'insert' | 'replace' = 'insert', count = 1, prefix = ''): void {
        this.buffer.begin(this.cursor);
        this.cursor = at;
        this.mode = mode;
        this.#insert = { count, prefix, typed: '' };
        this.#replaced = [];
        this.wantHere();
    }

    // ── Insert and Replace mode ──────────────────────────────────────────────────────────────────────────────────────

    #insertKey(name: string): void {
        let { line, col } = this.cursor;
        let session = this.#insert;
        switch (name) {
            case '<Esc>': case '<C-c>':
                this.#leaveInsert();
                return;
            case '<CR>':
                this.cursor = this.buffer.insert(this.cursor, '\n');
                if (session !== undefined) session.typed += '\n';
                break;
            case '<Tab>':
                this.#type('\t');
                break;
            case '<BS>': case '<C-h>':
                if (this.mode === 'replace') {
                    if (col === 0 || this.#replaced.length === 0) { this.#moveTo({ line, col: col - 1 }); return; }
                    let original = this.#replaced.pop()!;
                    this.buffer.delete({ line, col: col - 1 }, this.cursor);
                    if (original !== '') this.buffer.insert({ line, col: col - 1 }, original);
                    this.cursor = { line, col: col - 1 };
                } else if (col > 0) {
                    this.buffer.delete({ line, col: col - 1 }, this.cursor);
                    this.cursor = { line, col: col - 1 };
                } else if (line > 0) {
                    let end = this.buffer.line(line - 1).length;
                    this.buffer.delete({ line: line - 1, col: end }, this.cursor);
                    this.cursor = { line: line - 1, col: end };
                }
                if (session !== undefined) session.typed = session.typed.slice(0, -1);
                break;
            case '<Del>':
                if (col < this.buffer.line(line).length) this.buffer.delete(this.cursor, { line, col: col + 1 });
                else if (line + 1 < this.buffer.lineCount) this.buffer.delete(this.cursor, { line: line + 1, col: 0 });
                break;
            case '<C-w>': {
                // The word before the cursor (and the blanks after it), within the line.
                let text = this.buffer.line(line);
                let start = col;
                while (start > 0 && /\s/.test(text.charAt(start - 1))) start--;
                let word = start > 0 && /\w/.test(text.charAt(start - 1));
                while (start > 0 && /\S/.test(text.charAt(start - 1)) && /\w/.test(text.charAt(start - 1)) === word) {
                    start--;
                }
                if (start === col) return;
                this.buffer.delete({ line, col: start }, this.cursor);
                this.cursor = { line, col: start };
                break;
            }
            case '<C-u>':
                if (col === 0) return;
                this.buffer.delete({ line, col: 0 }, this.cursor);
                this.cursor = { line, col: 0 };
                break;
            case '<Left>': this.#moveTo({ line, col: col - 1 }); return;
            case '<Right>': this.#moveTo({ line, col: col + 1 }); return;
            case '<Up>': case '<Down>': {
                let target = Math.max(0, Math.min(line + (name === '<Up>' ? -1 : 1), this.buffer.lineCount - 1));
                this.cursor = this.buffer.clamp({ line: target, col: this.wantedCol(target) });
                return;
            }
            case '<Home>': this.#moveTo({ line, col: 0 }); return;
            case '<End>': this.#moveTo({ line, col: this.buffer.line(line).length }); return;
            case '<C-Left>': case '<S-Left>': case '<C-Right>': case '<S-Right>': {
                let target = runMotion(name.endsWith('Left>') ? 'b' : 'w', {
                    buffer: this.buffer, cursor: this.cursor, count: 1, counted: false, want: this.want,
                    top: this.top, rows: this.rows,
                });
                if (target !== undefined) this.#moveTo(target.pos);
                return;
            }
            default:
                if (!isCharKey(name)) return;
                this.#type(name);
        }
        this.wantHere();
    }

    /** Type one character: inserted, or in Replace mode written over the character under the cursor. */
    #type(text: string): void {
        let { line, col } = this.cursor;
        if (this.mode === 'replace') {
            let original = col < this.buffer.line(line).length ? this.buffer.line(line).charAt(col) : '';
            if (original !== '') this.buffer.delete(this.cursor, { line, col: col + 1 });
            this.#replaced.push(original);
        }
        this.cursor = this.buffer.insert(this.cursor, text);
        if (this.#insert !== undefined) this.#insert.typed += text;
    }

    #leaveInsert(): void {
        let session = this.#insert;
        this.#insert = undefined;
        if (session !== undefined && session.count > 1 && session.typed !== '') {
            let again = (session.prefix + session.typed).repeat(session.count - 1);
            if (this.mode === 'replace') {
                // Replacing again overwrites further characters.
                let { line, col } = this.cursor;
                let room = this.buffer.line(line).length - col;
                this.buffer.delete(this.cursor, { line, col: col + Math.min(room, again.length) });
            }
            this.cursor = this.buffer.insert(this.cursor, again);
        }
        this.buffer.end(this.cursor);
        this.mode = 'normal';
        this.cursor = this.normalCol({ line: this.cursor.line, col: this.cursor.col - 1 });
        this.wantHere();
        this.#normal.insertDone();
    }

    #moveTo(pos: Position): void {
        this.cursor = this.buffer.clamp(pos);
        this.wantHere();
    }

    // ── Command line ─────────────────────────────────────────────────────────────────────────────────────────────────

    #commandLine(name: string): void {
        switch (name) {
            case '<Esc>': case '<C-c>':
                this.mode = 'normal';
                this.command = '';
                return;
            case '<CR>': {
                let command = this.command;
                this.mode = 'normal';
                this.command = '';
                this.message = '';
                this.error = false;
                execute(this, command);
                this.cursor = this.normalCol(this.cursor);
                return;
            }
            case '<BS>':
                if (this.command === '') this.mode = 'normal';
                else this.command = this.command.slice(0, -1);
                return;
            default:
                if (isCharKey(name)) this.command += name;
        }
    }
}

/** `3L, 42B`: the line and byte count vim shows for a file. */
function describe(text: string): string {
    let lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return `${lines}L, ${text.length}B`;
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
