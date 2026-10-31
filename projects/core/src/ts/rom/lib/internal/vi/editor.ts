// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/editor.ts — the state of the vi editor and what keys do to it, without any terminal: /rom/bin/vi
// feeds it the decoded input and draws it with ./view.ts, and the tests drive it directly.
//
// Keys are named as in vim's documentation: a typed character is itself ('a', 'A', ':'), others are '<Esc>', '<CR>',
// '<BS>', '<Del>', '<Tab>', '<Up>' …, with Ctrl '<C-r>'.

import { TextBuffer, type Position } from '/rom/lib/internal/vi/buffer';
import { Key } from '/rom/lib/internal/keys';
import { execute } from '/rom/lib/internal/vi/ex';

export type Mode = 'normal' | 'insert' | 'command';

/** How the editor reads and writes files (fs in vi; a map in the tests). */
export interface FileIO {
    /** The file's text, or undefined if it does not exist. Throws if it cannot be read. */
    read(path: string): string | undefined;
    /** Write the file; throws if it cannot be written. */
    write(path: string, text: string): void;
}

/** The width of a tab on screen. */
export const TAB_WIDTH = 4;

/** The screen column (from 0) of column `col` of `line`, tabs expanded. */
export function displayCol(line: string, col: number): number {
    let x = 0;
    for (let i = 0; i < col && i < line.length; i++) x += line.charAt(i) === '\t' ? TAB_WIDTH - (x % TAB_WIDTH) : 1;
    return x;
}

/** The column of `line` shown at screen column `x` (or the last one before it). */
export function colAtDisplay(line: string, x: number): number {
    let at = 0;
    for (let i = 0; i < line.length; i++) {
        let next = at + (line.charAt(i) === '\t' ? TAB_WIDTH - (at % TAB_WIDTH) : 1);
        if (next > x) return i;
        at = next;
    }
    return line.length;
}

/** `line` with its tabs expanded to spaces. */
export function expandTabs(line: string): string {
    if (line.indexOf('\t') < 0) return line;
    let out = '';
    for (let ch of line) out += ch === '\t' ? ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : ch;
    return out;
}

const NAMED_KEYS: Record<string, string> = {
    [Key.ESCAPE]: '<Esc>', [Key.ENTER]: '<CR>', [Key.NUMPAD_ENTER]: '<CR>', [Key.BACKSPACE]: '<BS>',
    [Key.DELETE]: '<Del>', [Key.TAB]: '<Tab>', [Key.ARROW_UP]: '<Up>', [Key.ARROW_DOWN]: '<Down>',
    [Key.ARROW_LEFT]: '<Left>', [Key.ARROW_RIGHT]: '<Right>', [Key.HOME]: '<Home>', [Key.END]: '<End>',
    [Key.PAGE_UP]: '<PageUp>', [Key.PAGE_DOWN]: '<PageDown>', [Key.INSERT]: '<Insert>',
};

/** The vim name of a key press ('a', '<Esc>', '<C-r>'), or undefined for keys vi ignores (a modifier alone, F13). */
export function keyName(key: TtyKeyInput): string | undefined {
    let named = NAMED_KEYS[key.code];
    if (named !== undefined) return named;
    if (key.ctrlKey && /^Key[A-Z]$/.test(key.code)) return `<C-${key.code.charAt(3).toLowerCase()}>`;
    if (key.ctrlKey || key.altKey || key.metaKey) return undefined;
    return Array.from(key.key).length === 1 ? key.key : undefined;
}

export class Editor {
    readonly buffer: TextBuffer;
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

    readonly #io: FileIO;
    /** The screen column vertical moves try to keep (Infinity after '$': the end of every line). */
    #want = 0;
    /** The first key of a two-key command waiting for its second ('Z'). */
    #pending = '';

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
        if (this.mode === 'insert') {
            this.cursor = this.buffer.insert(this.cursor, body, this.cursor);
        } else {
            this.buffer.begin(this.cursor);
            let end = this.buffer.insert(this.cursor, body, this.cursor);
            this.cursor = this.#normalCol({ line: end.line, col: end.col - 1 });
            this.buffer.end(this.cursor);
        }
        this.#wantHere();
        this.follow();
    }

    /** One key, by its vim name. */
    feed(name: string): void {
        if (this.mode !== 'command') { this.message = ''; this.error = false; }
        switch (this.mode) {
            case 'normal': this.#normal(name); break;
            case 'insert': this.#insert(name); break;
            case 'command': this.#commandLine(name); break;
        }
        this.follow();
    }

    /** Show an error message (an ex command failed). */
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
        this.#wantHere();
    }

    // ── Normal mode ──────────────────────────────────────────────────────────────────────────────────────────────────

    #normal(name: string): void {
        if (this.#pending === 'Z') {
            this.#pending = '';
            if (name === 'Z') execute(this, 'x');
            else if (name === 'Q') execute(this, 'q!');
            return;
        }
        let { line, col } = this.cursor;
        let text = this.buffer.line(line);
        switch (name) {
            case 'h': case '<Left>': case '<BS>':
                this.#moveTo({ line, col: col - 1 });
                break;
            case 'l': case '<Right>': case ' ':
                this.#moveTo({ line, col: col + 1 });
                break;
            case 'j': case '<Down>': case '<C-n>': case '<CR>':
                this.#vertical(1, name === '<CR>');
                break;
            case 'k': case '<Up>': case '<C-p>':
                this.#vertical(-1, false);
                break;
            case '0': case '<Home>':
                this.#moveTo({ line, col: 0 });
                break;
            case '$': case '<End>':
                this.#moveTo({ line, col: text.length });
                this.#want = Infinity;
                break;
            case '<PageDown>': case '<C-f>':
                this.#page(1);
                break;
            case '<PageUp>': case '<C-b>':
                this.#page(-1);
                break;
            case 'i': case '<Insert>':
                this.#startInsert(this.cursor);
                break;
            case 'a':
                this.#startInsert({ line, col: Math.min(col + 1, text.length) });
                break;
            case 'I':
                this.#startInsert({ line, col: firstNonBlank(text) });
                break;
            case 'A':
                this.#startInsert({ line, col: text.length });
                break;
            case 'o':
                this.buffer.begin(this.cursor);
                this.#startInsert(this.buffer.insert({ line, col: text.length }, '\n'));
                break;
            case 'O':
                this.buffer.begin(this.cursor);
                this.buffer.insert({ line, col: 0 }, '\n');
                this.#startInsert({ line, col: 0 });
                break;
            case 'x': case '<Del>':
                if (text.length > 0) {
                    this.buffer.delete({ line, col }, { line, col: col + 1 }, this.cursor);
                    this.cursor = this.#normalCol(this.cursor);
                }
                break;
            case 'u':
                this.#restore(this.buffer.undo(), 'Already at oldest change');
                break;
            case '<C-r>':
                this.#restore(this.buffer.redo(), 'Already at newest change');
                break;
            case ':':
                this.mode = 'command';
                this.command = '';
                break;
            case 'Z':
                this.#pending = 'Z';
                break;
            case '<C-c>':
                this.message = 'Type  :q!  and press <Enter> to abandon all changes and exit vi';
                break;
            default:
        }
    }

    #startInsert(at: Position): void {
        this.buffer.begin(this.cursor);
        this.cursor = at;
        this.mode = 'insert';
        this.#wantHere();
    }

    #restore(pos: Position | undefined, nothing: string): void {
        if (pos === undefined) { this.message = nothing; return; }
        this.cursor = this.#normalCol(pos);
        this.#wantHere();
    }

    #moveTo(pos: Position): void {
        let target = this.mode === 'normal' ? this.#normalCol(pos) : this.buffer.clamp(pos);
        // A move that fails (h at the start, l at the end) keeps the column vertical moves aim for, as in vim.
        if (target.line === this.cursor.line && target.col === this.cursor.col && pos.col !== target.col) return;
        this.cursor = target;
        this.#wantHere();
    }

    #vertical(delta: number, firstColumn: boolean): void {
        let line = Math.max(0, Math.min(this.cursor.line + delta, this.buffer.lineCount - 1));
        let text = this.buffer.line(line);
        let col = firstColumn ? firstNonBlank(text)
            : this.#want === Infinity ? text.length : colAtDisplay(text, this.#want);
        this.cursor = this.mode === 'normal' ? this.#normalCol({ line, col }) : this.buffer.clamp({ line, col });
        if (firstColumn) this.#wantHere();
    }

    #page(direction: number): void {
        let step = Math.max(1, this.rows - 2);
        this.top = Math.max(0, Math.min(this.top + direction * step, this.buffer.lineCount - 1));
        let line = Math.max(this.top, Math.min(this.cursor.line + direction * step, this.buffer.lineCount - 1));
        this.cursor = this.#normalCol({ line, col: colAtDisplay(this.buffer.line(line), this.#want) });
    }

    /** `pos` clamped for Normal mode: the cursor sits on a character, not after the last one. */
    #normalCol(pos: Position): Position {
        let clamped = this.buffer.clamp(pos);
        let length = this.buffer.line(clamped.line).length;
        return { line: clamped.line, col: Math.max(0, Math.min(clamped.col, length - 1)) };
    }

    #wantHere(): void {
        this.#want = displayCol(this.buffer.line(this.cursor.line), this.cursor.col);
    }

    // ── Insert mode ──────────────────────────────────────────────────────────────────────────────────────────────────

    #insert(name: string): void {
        let { line, col } = this.cursor;
        switch (name) {
            case '<Esc>': case '<C-c>':
                this.buffer.end(this.cursor);
                this.mode = 'normal';
                this.cursor = this.#normalCol({ line, col: col - 1 });
                this.#wantHere();
                return;
            case '<CR>':
                this.cursor = this.buffer.insert(this.cursor, '\n');
                break;
            case '<Tab>':
                this.cursor = this.buffer.insert(this.cursor, '\t');
                break;
            case '<BS>':
                if (col > 0) {
                    this.buffer.delete({ line, col: col - 1 }, this.cursor);
                    this.cursor = { line, col: col - 1 };
                } else if (line > 0) {
                    let end = this.buffer.line(line - 1).length;
                    this.buffer.delete({ line: line - 1, col: end }, this.cursor);
                    this.cursor = { line: line - 1, col: end };
                }
                break;
            case '<Del>':
                if (col < this.buffer.line(line).length) this.buffer.delete(this.cursor, { line, col: col + 1 });
                else if (line + 1 < this.buffer.lineCount) this.buffer.delete(this.cursor, { line: line + 1, col: 0 });
                break;
            case '<Left>': this.#moveTo({ line, col: col - 1 }); return;
            case '<Right>': this.#moveTo({ line, col: col + 1 }); return;
            case '<Up>': this.#vertical(-1, false); return;
            case '<Down>': this.#vertical(1, false); return;
            case '<Home>': this.#moveTo({ line, col: 0 }); return;
            case '<End>': this.#moveTo({ line, col: this.buffer.line(line).length }); return;
            default:
                if (Array.from(name).length !== 1) return;
                this.cursor = this.buffer.insert(this.cursor, name);
        }
        this.#wantHere();
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
                this.cursor = this.#normalCol(this.cursor);
                return;
            }
            case '<BS>':
                if (this.command === '') this.mode = 'normal';
                else this.command = this.command.slice(0, -1);
                return;
            default:
                if (Array.from(name).length === 1) this.command += name;
        }
    }
}

/** The column of the first non-blank character of `text` (its length if there is none). */
export function firstNonBlank(text: string): number {
    let match = /\S/.exec(text);
    return match === null ? Math.max(0, text.length - 1) : match.index;
}

/** `3L, 42B`: the line and byte count vim shows for a file. */
function describe(text: string): string {
    let lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return `${lines}L, ${text.length}B`;
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
