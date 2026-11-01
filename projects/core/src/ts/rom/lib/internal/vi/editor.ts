// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/editor.ts — the state of the vi editor and what keys do to it, without any terminal: /rom/bin/vi
// feeds it the decoded input and draws it with ./view.ts, and the tests drive it directly. Normal mode (commands,
// motions, operators) and Visual mode are ./normal.ts; Insert, Replace and the command line are here.
//
// Keys are named as in vim's documentation: a typed character is itself ('a', 'A', ':'), others are '<Esc>', '<CR>',
// '<BS>', '<Del>', '<Tab>', '<Up>' …, with Ctrl '<C-r>' / '<C-Left>', with Shift '<S-Left>'.

import { TextBuffer, type Position } from '/rom/lib/internal/vi/buffer';
import { Key } from '/rom/lib/internal/keys';
import { execute } from '/rom/lib/internal/vi/ex';
import { firstNonBlank, runMotion, textObject } from '/rom/lib/internal/vi/motions';
import { NormalMode } from '/rom/lib/internal/vi/normal';
import { Registers } from '/rom/lib/internal/vi/registers';
import { compile, search } from '/rom/lib/internal/vi/search';
import { colAtDisplay, displayCol } from '/rom/lib/internal/vi/tabs';

export type Mode = 'normal' | 'insert' | 'replace' | 'command' | 'visual';

/** The kinds of Visual mode: characters (v), whole lines (V), a block of columns (Ctrl+V). */
export type VisualKind = 'char' | 'line' | 'block';

/** A Visual selection: where it started (the anchor, `o` swaps it with the cursor) and its kind. */
export interface Visual {
    kind: VisualKind;
    anchor: Position;
}

/**
 * The selected text: first and last position (both included), in text order; for a block also its screen columns
 * (`right` Infinity after '$': to the end of every line).
 */
export interface Selection {
    kind: VisualKind;
    start: Position;
    end: Position;
    left: number;
    right: number;
}

/** Text typed into a block (I, A, c in Visual block mode) goes into each of its lines when Insert mode ends. */
export interface BlockInsert {
    first: number;
    last: number;
    /** The screen column it goes to (Infinity: the end of each line). */
    x: number;
    /** Whether shorter lines are padded with spaces up to the column (A) or skipped (I). */
    pad: boolean;
}

/** How the editor reads and writes files (fs in vi; a map in the tests). */
export interface FileIO {
    /** The file's text, or undefined if it does not exist. Throws if it cannot be read. */
    read(path: string): string | undefined;
    /** Write the file; throws if it cannot be written. */
    write(path: string, text: string): void;
}

/** How soon a second click counts as a double click. */
const DOUBLE_CLICK_MS = 400;

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
    block?: BlockInsert;
}

export class Editor {
    buffer: TextBuffer;
    readonly registers = new Registers();
    /** The file being edited (undefined: none yet, `:w name` sets it). */
    path: string | undefined;
    cursor: Position = { line: 0, col: 0 };
    mode: Mode = 'normal';
    /** The command line being typed after `prompt`: ':' for an ex command, '/' or '?' for a search. */
    command = '';
    prompt: ':' | '/' | '?' = ':';
    /** The options :set changes. */
    options = {
        number: false, relativenumber: false, ignorecase: false, smartcase: false, hlsearch: false, wrapscan: true,
        shiftwidth: 4,
    };
    /** The last search (/, ?, *, #, :s) and whether its matches are highlighted ('hlsearch'; :noh stops it). */
    lastSearch: { pattern: string; forward: boolean } | undefined;
    highlight = false;
    /** The last :s, for :s without a pattern and &. */
    lastSubstitute: { pattern: string; replacement: string; flags: string } | undefined;
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
    /** The Visual selection while in Visual mode, and the last one (gv selects it again). */
    visual: Visual | undefined;
    lastVisual: { kind: VisualKind; anchor: Position; cursor: Position } | undefined;

    /** The time in milliseconds, for double clicks (the tests set their own). */
    now: () => number = () => Date.now();

    readonly #io: FileIO;
    readonly #normal: NormalMode;
    /** The last left click (for double and triple clicks) and where a drag started. */
    #clicks = { count: 0, at: 0, line: -1, col: -1 };
    #drag: Position | undefined;
    #commandFromVisual = false;
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
        this.width = Math.max(1, width - this.gutter());
        this.rows = Math.max(1, rows);
        this.follow();
    }

    /** The width of the line numbers in front of the text ('number', 'relativenumber'), 0 without them. */
    gutter(): number {
        if (!this.options.number && !this.options.relativenumber) return 0;
        return Math.max(3, String(this.buffer.lineCount).length) + 1;
    }

    // ── Search ───────────────────────────────────────────────────────────────────────────────────────────────────────

    /** Start typing a command line: ':' (ex) or '/' / '?' (a search forward / backward). */
    startCommand(prompt: ':' | '/' | '?', text = ''): void {
        // A search typed in Visual mode moves the end of the selection: Visual mode goes on afterwards.
        this.#commandFromVisual = this.mode === 'visual';
        this.mode = 'command';
        this.prompt = prompt;
        this.command = text;
    }

    /**
     * Search for `pattern` (forward or backward from the cursor, `count` matches on) and move the cursor to the match;
     * false (with vim's message) if there is none. It becomes the last search, and its matches are highlighted if
     * 'hlsearch' is on.
     */
    search(pattern: string, forward: boolean, count = 1, remember = true): boolean {
        if (remember) this.lastSearch = { pattern, forward };
        let regex = compile(pattern, this.options);
        if (typeof regex === 'string') { this.fail(regex); return false; }
        this.highlight = true;
        let pos = this.cursor;
        let wrapped = false;
        for (let i = 0; i < count; i++) {
            let found = search(this.buffer, regex, pos, forward, this.options.wrapscan);
            if (found === undefined) {
                this.fail(this.options.wrapscan ? `E486: Pattern not found: ${pattern}`
                    : `E${forward ? 385 : 384}: Search hit ${forward ? 'BOTTOM' : 'TOP'} without match for: ${pattern}`);
                return false;
            }
            pos = found.pos;
            wrapped ||= found.wrapped;
        }
        this.cursor = this.mode === 'visual' ? pos : this.normalCol(pos);
        this.wantHere();
        this.message = wrapped
            ? (forward ? 'search hit BOTTOM, continuing at TOP' : 'search hit TOP, continuing at BOTTOM')
            : `${forward ? '/' : '?'}${pattern}`;
        return true;
    }

    /** n / N: the last search again, in its direction (or the other one). */
    searchAgain(reverse: boolean, count: number): void {
        let last = this.lastSearch;
        if (last === undefined) { this.fail('E35: No previous regular expression'); return; }
        this.search(last.pattern, reverse ? !last.forward : last.forward, count, false);
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
            case 'visual': this.#normal.feedVisual(name); break;
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
    startInsert(
        at: Position, mode: 'insert' | 'replace' = 'insert', count = 1, prefix = '', block?: BlockInsert,
    ): void {
        this.buffer.begin(this.cursor);
        this.cursor = at;
        this.mode = mode;
        this.#insert = { count, prefix, typed: '', block };
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
        if (session?.block !== undefined && session.typed !== '' && session.typed.indexOf('\n') < 0) {
            this.#fillBlock(session.block, session.typed);
        }
        this.buffer.end(this.cursor);
        this.mode = 'normal';
        this.cursor = this.normalCol({ line: this.cursor.line, col: this.cursor.col - 1 });
        this.wantHere();
        this.#normal.insertDone();
    }

    /** Put the text typed on a block's first line into its other lines, at the same screen column. */
    #fillBlock(block: BlockInsert, text: string): void {
        for (let line = block.first + 1; line <= block.last; line++) {
            let current = this.buffer.line(line);
            let width = displayCol(current, current.length);
            let col: number;
            if (block.x === Infinity) {
                col = current.length;
            } else if (width < block.x) {
                if (!block.pad) continue;
                this.buffer.insert({ line, col: current.length }, ' '.repeat(block.x - width));
                col = this.buffer.line(line).length;
            } else {
                col = colAtDisplay(current, block.x);
            }
            this.buffer.insert({ line, col }, text);
        }
    }

    // ── Line operations (Normal mode, Visual mode and ex commands) ───────────────────────────────────────────────────

    /** The text of lines `first` to `last`, joined with '\n'. */
    linesText(first: number, last: number): string {
        let lines: string[] = [];
        for (let line = first; line <= last; line++) lines.push(this.buffer.line(line));
        return lines.join('\n');
    }

    /** Remove lines `first` to `last` (at least one empty line stays); the cursor goes to the line after them. */
    removeLines(first: number, last: number): void {
        let buffer = this.buffer;
        let lastEnd = { line: last, col: buffer.line(last).length };
        if (last < buffer.lineCount - 1) {
            buffer.delete({ line: first, col: 0 }, { line: last + 1, col: 0 }, this.cursor);
        } else if (first > 0) {
            // The last lines: the line break before them goes too.
            buffer.delete({ line: first - 1, col: buffer.line(first - 1).length }, lastEnd, this.cursor);
        } else {
            buffer.delete({ line: 0, col: 0 }, lastEnd, this.cursor);
        }
        this.gotoLine(Math.min(first, buffer.lineCount - 1));
    }

    /** :d: delete lines `first` to `last` into `register`. */
    deleteLines(first: number, last: number, register?: string): void {
        this.registers.delete(register, { text: this.linesText(first, last), linewise: true });
        this.removeLines(first, last);
    }

    /** :y: yank lines `first` to `last` into `register`. */
    yankLines(first: number, last: number, register?: string): void {
        this.registers.yank(register, { text: this.linesText(first, last), linewise: true });
    }

    /** > / <: shift lines `first` to `last` right or left by 'shiftwidth' spaces (a tab counts as one), `times` times. */
    shiftLines(first: number, last: number, right: boolean, times: number): void {
        let width = this.options.shiftwidth;
        for (let line = first; line <= last; line++) {
            let text = this.buffer.line(line);
            if (right) {
                if (text !== '') this.buffer.insert({ line, col: 0 }, ' '.repeat(width * times), this.cursor);
                continue;
            }
            let remove = 0;
            for (let i = 0; i < times; i++) {
                let rest = text.slice(remove);
                remove += rest.startsWith('\t') ? 1 : new RegExp(`^ {0,${width}}`).exec(rest)![0].length;
            }
            if (remove > 0) this.buffer.delete({ line, col: 0 }, { line, col: remove }, this.cursor);
        }
        this.gotoLine(first);
    }

    /**
     * J / gJ / :j: join lines `first` to `last` into one. With `spaces` (J) the joined lines lose their indent and get
     * one space between (none before ')' or after a blank); the cursor goes where the last join was.
     */
    joinLines(first: number, last: number, spaces: boolean): void {
        let buffer = this.buffer;
        if (first + 1 >= buffer.lineCount) return;
        let joinCol = 0;
        for (let i = first; i < last && first + 1 < buffer.lineCount; i++) {
            let current = buffer.line(first);
            let next = buffer.line(first + 1);
            let indent = spaces ? /^\s*/.exec(next)![0].length : 0;
            let rest = next.slice(indent);
            let tight = !spaces || rest === '' || current === '' || /\s$/.test(current) || rest.startsWith(')');
            buffer.delete({ line: first, col: current.length }, { line: first + 1, col: indent }, this.cursor);
            if (!tight) buffer.insert({ line: first, col: current.length }, ' ');
            joinCol = current.length;
        }
        this.cursor = this.normalCol({ line: first, col: joinCol });
        this.wantHere();
    }

    /** :t / :m: copy (or move) lines `first` to `last` below line `after` (-1: above the first line). */
    copyLines(first: number, last: number, after: number, move: boolean): void {
        let text = this.linesText(first, last);
        let count = last - first + 1;
        let buffer = this.buffer;
        let target = after;
        if (move) {
            this.removeLines(first, last);
            if (after > last) target -= count;
        }
        if (target < 0) buffer.insert({ line: 0, col: 0 }, text + '\n', this.cursor);
        else buffer.insert({ line: target, col: buffer.line(target).length }, '\n' + text, this.cursor);
        this.gotoLine(target + count);
    }

    /** :e: edit `path` instead (the same file again: as it is on disk). */
    open(path: string): void {
        let text: string | undefined;
        try {
            text = this.#io.read(path);
        } catch (e) {
            this.fail(`"${path}" ${errorText(e)}`);
            return;
        }
        this.message = text === undefined ? `"${path}" [New]` : `"${path}" ${describe(text)}`;
        if (text !== undefined && text.endsWith('\n')) text = text.slice(0, -1);
        this.buffer = new TextBuffer(text ?? '');
        this.buffer.markSaved();
        this.path = path;
        this.cursor = { line: 0, col: 0 };
        this.top = 0;
        this.left = 0;
        this.visual = undefined;
        this.lastVisual = undefined;
        this.wantHere();
    }

    /** Enter Visual mode, selecting from `anchor` to the cursor. */
    startVisual(kind: VisualKind, anchor: Position): void {
        this.visual = { kind, anchor };
        this.mode = 'visual';
    }

    /** Leave Visual mode, remembering the selection for gv. */
    endVisual(): void {
        let visual = this.visual;
        if (visual !== undefined) this.lastVisual = { kind: visual.kind, anchor: visual.anchor, cursor: this.cursor };
        this.visual = undefined;
        if (this.mode === 'visual') this.mode = 'normal';
    }

    // ── Mouse ────────────────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * A mouse report (vi asks for them, as vim with 'mouse=a'): a left click puts the cursor there (staying in Insert
     * mode, ending a selection), dragging selects (Visual mode from where the button went down), a double click
     * selects a word and a triple click a line; the wheel scrolls three lines.
     */
    handleMouse(mouse: TtyMouseInput): void {
        if (mouse.action === 'scroll') {
            this.#scrollBy(3 * mouse.direction);
            return;
        }
        if (mouse.button !== 'left' && mouse.action !== 'release') return;
        if (mouse.action === 'release') {
            this.#drag = undefined;
            return;
        }
        let pos = this.#positionAt(mouse.x, mouse.y);
        if (pos === undefined) return;
        this.message = '';
        this.error = false;
        if (mouse.action === 'press') {
            this.#pressed(pos);
        } else if (mouse.action === 'drag' && this.#drag !== undefined) {
            if (this.mode === 'insert' || this.mode === 'replace') this.feed('<Esc>');
            if (this.mode === 'command') return;
            if (this.mode !== 'visual') this.startVisual('char', this.#drag);
            this.cursor = this.normalCol(pos);
            this.wantHere();
        }
        this.follow();
    }

    #pressed(pos: Position): void {
        // A second or third press on the same cell soon after the first is a double or triple click.
        let now = this.now();
        let clicks = this.#clicks;
        let again = now - clicks.at <= DOUBLE_CLICK_MS && clicks.line === pos.line && clicks.col === pos.col;
        this.#clicks = { count: again ? clicks.count % 3 + 1 : 1, at: now, line: pos.line, col: pos.col };
        this.#normal.clear();
        if (this.mode === 'command') { this.mode = 'normal'; this.command = ''; }
        switch (this.#clicks.count) {
            case 2: {
                if (this.mode === 'insert' || this.mode === 'replace') this.feed('<Esc>');
                let word = textObject(this.buffer, pos, false, 'w');
                if (word === undefined) return;
                if (this.mode === 'visual') this.endVisual();
                this.startVisual('char', word.start);
                this.cursor = { line: word.end.line, col: Math.max(word.start.col, word.end.col - 1) };
                this.#drag = undefined;
                break;
            }
            case 3:
                if (this.mode === 'visual') this.endVisual();
                this.startVisual('line', { line: pos.line, col: 0 });
                this.cursor = this.normalCol(pos);
                this.#drag = undefined;
                break;
            default:
                if (this.mode === 'visual') this.endVisual();
                let typing = this.mode === 'insert' || this.mode === 'replace';
                this.cursor = typing ? this.buffer.clamp(pos) : this.normalCol(pos);
                this.#drag = this.cursor;
        }
        this.wantHere();
    }

    /** The text position shown at screen cell (x, y), or undefined for the last row. */
    #positionAt(x: number, y: number): Position | undefined {
        if (y < 0 || y >= this.rows) return undefined;
        let line = Math.min(this.top + y, this.buffer.lineCount - 1);
        return { line, col: colAtDisplay(this.buffer.line(line), this.left + Math.max(0, x - this.gutter())) };
    }

    /** Scroll the view by `lines`; the cursor moves just enough to stay on screen. */
    #scrollBy(lines: number): void {
        let last = this.buffer.lineCount - 1;
        this.top = Math.max(0, Math.min(this.top + lines, last));
        let line = Math.max(this.top, Math.min(this.cursor.line, this.top + this.rows - 1, last));
        if (line !== this.cursor.line) {
            let col = this.wantedCol(line);
            this.cursor = this.mode === 'insert' || this.mode === 'replace'
                ? this.buffer.clamp({ line, col }) : this.normalCol({ line, col });
        }
    }

    /** The current Visual selection, or undefined outside Visual mode. */
    selection(): Selection | undefined {
        let visual = this.visual;
        if (visual === undefined) return undefined;
        let a = visual.anchor;
        let b = this.cursor;
        let [start, end] = a.line < b.line || (a.line === b.line && a.col <= b.col) ? [a, b] : [b, a];
        let xa = displayCol(this.buffer.line(a.line), a.col);
        let xb = displayCol(this.buffer.line(b.line), b.col);
        let right = this.want === 'end' ? Infinity : Math.max(xa, xb);
        return { kind: visual.kind, start, end, left: Math.min(xa, xb), right };
    }

    #moveTo(pos: Position): void {
        this.cursor = this.buffer.clamp(pos);
        this.wantHere();
    }

    // ── Command line ─────────────────────────────────────────────────────────────────────────────────────────────────

    #commandLine(name: string): void {
        switch (name) {
            case '<Esc>': case '<C-c>':
                this.mode = this.#commandFromVisual ? 'visual' : 'normal';
                this.command = '';
                return;
            case '<CR>': {
                let command = this.command;
                this.mode = this.#commandFromVisual ? 'visual' : 'normal';
                this.command = '';
                this.message = '';
                this.error = false;
                if (this.prompt !== ':') {
                    let forward = this.prompt === '/';
                    let pattern = command !== '' ? command : this.lastSearch?.pattern;
                    if (pattern === undefined) this.fail('E35: No previous regular expression');
                    else this.search(pattern, forward);
                    return;
                }
                // An ex command is one undo step.
                this.buffer.begin(this.cursor);
                try {
                    execute(this, command);
                } finally {
                    this.buffer.end(this.cursor);
                }
                if (this.mode === 'normal') this.cursor = this.normalCol(this.cursor);
                return;
            }
            case '<BS>':
                if (this.command === '') this.mode = this.#commandFromVisual ? 'visual' : 'normal';
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
