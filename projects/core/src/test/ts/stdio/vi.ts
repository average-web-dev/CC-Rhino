// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The vi editor (/rom/lib/internal/vi), driven with keys as a terminal sends them, without a TTY. Run by
// StdioLibraryTest.

import * as prelude from './prelude';
import { decodeInput } from 'tty';

const eq = prelude.eq;

/** The part of the (internal, untyped here) Editor the tests use. */
interface Editor {
    readonly buffer: { text(): string; line(i: number): string; readonly modified: boolean };
    readonly cursor: { line: number; col: number };
    readonly mode: string;
    readonly message: string;
    readonly error: boolean;
    readonly quit: boolean;
    readonly path: string | undefined;
    readonly top: number;
    setSize(width: number, rows: number): void;
    handleKey(key: TtyKeyInput): void;
    handlePaste(text: string): void;
}
// A plain require: an import would compile the ROM source into this test.
const Editor: new (io: unknown, path?: string) => Editor = (require('/rom/lib/internal/vi/editor') as any).Editor;

/** Files in memory. */
const files: Record<string, string> = {};
const io = {
    read: (path: string) => files[path],
    write: (path: string, text: string) => { files[path] = text; },
};

/** What a terminal sends for the vim key names in `keys`: '<Esc>', '<CR>', '<BS>', '<C-r>', arrows. */
const SEQUENCES: Record<string, string> = {
    '<Esc>': '\x1b', '<CR>': '\r', '<BS>': '\x7f', '<Tab>': '\t', '<C-r>': '\x12', '<C-c>': '\x03',
    '<Up>': '\x1b[A', '<Down>': '\x1b[B', '<Right>': '\x1b[C', '<Left>': '\x1b[D', '<Del>': '\x1b[3~',
    '<Home>': '\x1b[H', '<End>': '\x1b[F', '<PageDown>': '\x1b[6~', '<PageUp>': '\x1b[5~',
};

/** Type `keys` (characters, or vim names like '<Esc>') into `editor`, each key decoded as the terminal sends it. */
function type(editor: Editor, keys: string): void {
    for (let token of keys.match(/<[^>]+>|[\s\S]/g) ?? []) {
        let sequence = SEQUENCES[token] ?? token;
        for (let input of decodeInput(sequence)) if (input.type === 'keydown') editor.handleKey(input);
    }
}

function open(text?: string, path = '/f.txt'): Editor {
    if (text === undefined) delete files[path]; else files[path] = text;
    let editor = new Editor(io, path);
    editor.setSize(20, 5);
    return editor;
}

function lines(editor: Editor): string {
    return editor.buffer.text().split('\n').join('|');
}

function at(editor: Editor): string {
    return `${editor.cursor.line},${editor.cursor.col}`;
}

// ── Opening and writing ─────────────────────────────────────────────────────────────────────────────────────────────

let e = open('one\ntwo\n');
eq(lines(e), 'one|two', 'the final line break is no line of its own');
eq(e.message, '"/f.txt" 2L, 8B');
eq(open(undefined).message, '"/f.txt" [New]');

// ── Insert mode and Normal mode ─────────────────────────────────────────────────────────────────────────────────────

e = open('');
type(e, 'ihello<Esc>');
eq(lines(e), 'hello');
eq(e.mode, 'normal');
eq(at(e), '0,4', 'Esc moves left, onto the last character');
type(e, 'a!<Esc>');
eq(lines(e), 'hello!');
type(e, 'Ia <Esc>A?<Esc>');
eq(lines(e), 'a hello!?');
type(e, 'oline 2<CR>line 3<Esc>');
eq(lines(e), 'a hello!?|line 2|line 3');
type(e, 'kOtop<Esc>');
eq(lines(e), 'a hello!?|top|line 2|line 3', 'O opens a line above the cursor');
type(e, '0xx');
eq(lines(e), 'a hello!?|p|line 2|line 3');
type(e, 'jA<BS><BS><BS><BS>X<Esc>');
eq(lines(e), 'a hello!?|p|liX|line 3');
type(e, 'I<BS><Esc>');
eq(lines(e), 'a hello!?|pliX|line 3', 'Backspace at the start of a line joins it with the one above');
type(e, 'i<Tab><Esc>');
eq(e.buffer.line(1).startsWith('p\t') || e.buffer.line(1).indexOf('\t') >= 0, true, 'Tab inserts a tab');

// Moving: hjkl, arrows, 0 $, the column kept on the way through short lines.
e = open('long line here\nab\nanother long line');
type(e, '$');
eq(at(e), '0,13');
type(e, 'j');
eq(at(e), '1,1', 'a short line: its end');
type(e, 'j');
eq(at(e), '2,16', 'after $: the end of each line');
type(e, '0lll');
eq(at(e), '2,3');
type(e, 'kk');
eq(at(e), '0,3', 'the column is kept through a short line');
type(e, '<Down><Right><Up><Left>');
eq(at(e), '0,2', 'a failed move (Right at the end of "ab") keeps the column for the way back');
type(e, 'hhhh');
eq(at(e), '0,0', 'h stops at the start');

// ── Undo and redo ───────────────────────────────────────────────────────────────────────────────────────────────────

e = open('abc');
type(e, 'A def<CR>ghi<Esc>x');
eq(lines(e), 'abc def|gh');
type(e, 'u');
eq(lines(e), 'abc def|ghi', 'undo: the x');
type(e, 'u');
eq(lines(e), 'abc', 'undo: the whole Insert');
eq(e.buffer.modified, false, 'back to the file as read');
type(e, 'u');
eq(e.message, 'Already at oldest change');
type(e, '<C-r>');
eq(lines(e), 'abc def|ghi');
type(e, '<C-r><C-r>');
eq(lines(e), 'abc def|gh');
eq(e.message, 'Already at newest change');

// ── Paste ───────────────────────────────────────────────────────────────────────────────────────────────────────────

e = open('ab');
type(e, 'a');
e.handlePaste('x\ry');
type(e, '<Esc>');
eq(lines(e), 'ax|yb', 'pasted in Insert mode, as it is');
type(e, 'u');
eq(lines(e), 'ab', 'one undo step with the Insert');

// ── Ex commands ─────────────────────────────────────────────────────────────────────────────────────────────────────

e = open('text');
type(e, 'A!<Esc>:q<CR>');
eq(e.quit, false);
eq(e.message, 'E37: No write since last change (add ! to override)');
eq(e.error, true);
type(e, ':w<CR>');
eq(files['/f.txt'], 'text!\n');
eq(e.message, '"/f.txt" 1L, 6B written');
eq(e.buffer.modified, false);
type(e, ':q<CR>');
eq(e.quit, true);

e = open('x');
type(e, 'ddd:q!<CR>');
eq(e.quit, true, ':q! quits with changes');

e = open('a');
type(e, 'Ab<Esc>:wq<CR>');
eq(`${files['/f.txt']}|${e.quit}`, 'ab\n|true');

e = open('a');
type(e, ':x<CR>');
eq(e.quit, true, ':x without changes does not write');

e = open('a');
type(e, 'Ac<Esc>ZZ');
eq(`${files['/f.txt']}|${e.quit}`, 'ac\n|true');
e = open('a');
type(e, 'Ad<Esc>ZQ');
eq(`${files['/f.txt']}|${e.quit}`, 'a|true', 'ZQ quits without writing');
eq(files['/f.txt'], 'a', 'the file as it was, without a final line break');

e = open(undefined, '/new.txt');
type(e, 'inew<Esc>:w /other.txt<CR>');
eq(files['/other.txt'], 'new\n', ':w name writes a new file');
eq(e.path, '/new.txt');

e = open('1\n2\n3\n4\n5\n6\n7\n8');
type(e, ':6<CR>');
eq(at(e), '5,0');
type(e, ':$<CR>');
eq(at(e), '7,0');
eq(e.top, 3, 'scrolled to show the cursor (5 rows)');
type(e, ':nope<CR>');
eq(e.message, 'E492: Not an editor command: nope');
type(e, ':abc<BS><BS><BS><BS>');
eq(e.mode, 'normal', 'Backspace on an empty command line leaves it');

eq(Object.keys(files).sort().join(), '/f.txt,/other.txt');
