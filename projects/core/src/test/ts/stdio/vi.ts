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
    readonly registers: { get(name?: string): { text: string; linewise: boolean } | undefined };
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
    '<C-Left>': '\x1b[1;5D', '<C-Right>': '\x1b[1;5C', '<C-w>': '\x17', '<C-u>': '\x15', '<C-d>': '\x04',
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
type(e, 'x:q!<CR>');
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

// ── Motions (phase 2) ───────────────────────────────────────────────────────────────────────────────────────────────

/** The columns the cursor visits, typing `key` `times` times from the start of a one-line text. */
function walk(text: string, keys: string, times: number, start = '0'): string {
    let editor = open(text);
    type(editor, start);
    let cols: number[] = [];
    for (let i = 0; i < times; i++) { type(editor, keys); cols.push(editor.cursor.col); }
    return cols.join();
}

eq(walk('one two.three  four', 'w', 4), '4,7,8,15', 'w: words of letters and of punctuation');
eq(walk('one two.three  four', 'W', 2), '4,15', 'W: runs of non-blanks');
eq(walk('one two.three  four', 'e', 4), '2,6,7,12', 'e');
eq(walk('one two.three  four', 'b', 4, '$'), '15,8,7,4', 'b from the end');
eq(walk('one two.three  four', 'ge', 3, '$'), '12,7,6', 'ge');
eq(walk('one two.three  four', '<C-Right>', 2), '4,7', 'Ctrl+Right is w');
eq(walk('one two.three  four', '<C-Left>', 2, '$'), '15,8', 'Ctrl+Left is b');
eq(walk('a,b,c,d', 'f,', 2), '1,3');
eq(walk('a,b,c,d', ';', 2, 'f,'), '3,5', '; repeats f');
eq(walk('a,b,c,d', ',', 1, '$F,'), '5', ', reverses F');
eq(walk('a,b,c,d', 't,', 1, '2l'), '2', 't stops before; repeated it would not move…');
eq(walk('a,b,c,d', ';', 1, '2lt,'), '4', '…so ; skips the character next to the cursor');
eq(walk('a(b[c]d)e', '%', 2), '7,1', '% jumps between brackets');
eq(walk('  indented', '^', 1, '$'), '2');

e = open('one two three four five');
type(e, '3w');
eq(at(e), '0,14', 'a count');
type(e, '2b');
eq(at(e), '0,4');

e = open('1\n2\n3\n4\n5\n\n7\n8');
type(e, 'G');
eq(at(e), '7,0');
type(e, '3G');
eq(at(e), '2,0');
type(e, 'gg');
eq(at(e), '0,0');
type(e, '}');
eq(at(e), '5,0', '} to the next empty line');
type(e, '}');
eq(at(e), '7,0', '…or the end');
type(e, '{');
eq(at(e), '5,0');

// ── Operators ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** `text` after typing `keys` in Normal mode. */
function after(text: string, keys: string): string {
    let editor = open(text);
    type(editor, keys);
    return lines(editor);
}

eq(after('one two three', 'dw'), 'two three');
eq(after('one two three', 'd2w'), 'three');
eq(after('one two three', '2dw'), 'three');
eq(after('one two three', 'wdw'), 'one three');
eq(after('one two\nthree', 'wdw'), 'one |three', 'dw on the last word of a line stays on the line');
eq(after('one two three', 'cwX<Esc>'), 'X two three', 'cw changes to the end of the word');
eq(after('one two three', 'wcex<Esc>'), 'one x three');
eq(after('one two three', 'wd$'), 'one ');
eq(after('one two three', 'wD'), 'one ');
eq(after('one two three', 'wCend<Esc>'), 'one end');
eq(after('abcdef', 'x'), 'bcdef');
eq(after('abcdef', '3x'), 'def');
eq(after('abcdef', '$X'), 'abcdf');
eq(after('abcdef', '2sXY<Esc>'), 'XYcdef');
eq(after('abc', 'dft'), 'abc', 'a failed motion changes nothing');
eq(after('a\nb\nc\nd', 'dd'), 'b|c|d');
eq(after('a\nb\nc\nd', 'j2dd'), 'a|d');
eq(after('a\nb\nc\nd', 'Gdd'), 'a|b|c', 'the last line');
eq(after('a\nb', 'dddd'), '', 'all lines: one empty line remains');
eq(after('a\nb\nc\nd', 'jdj'), 'a|d', 'dj: linewise');
eq(after('a\nb\nc\nd', 'jjdk'), 'a|d');
eq(after('a\nb\nc\nd', 'jdG'), 'a');
eq(after('a\nb\nc\nd', 'jjdgg'), 'd');
eq(after('a\nb\n\nc', 'd}'), '|c', 'd} from the start of a paragraph: whole lines');
eq(after('one two', 'ccnew<Esc>'), 'new');
eq(after('  one\ntwo', 'Snew<Esc>'), '  new|two', 'S keeps the indent');
eq(after('a\nb', '>>j>>'), '    a|    b');
eq(after('a\nb', '2>>'), '    a|    b');
eq(after('        a', '<<'), '    a');
eq(after('a\nb\nc', '>j'), '    a|    b|c');
eq(after('one\n   two\nthree', 'J'), 'one two|three');
eq(after('one\n   two\nthree', '3J'), 'one two three');
eq(after('one\n   two', 'gJ'), 'one   two');
eq(after('f(\n)', 'J'), 'f()', 'no space before )');
eq(after('abc', '~~'), 'ABc');
eq(after('abc def', 'g~iw'), 'ABC def');
eq(after('abc def', 'gUiw'), 'ABC def');
eq(after('ABC DEF', 'guu'), 'abc def');
eq(after('abc', 'rx'), 'xbc');
eq(after('abc', '2rx'), 'xxc');
eq(after('abc', '4rx'), 'abc', 'r past the end does nothing');
eq(after('abcdef', 'lRXY<Esc>'), 'aXYdef');
eq(after('abc', 'lRXYZW<BS><BS><Esc>'), 'aXY', 'Backspace in Replace mode brings the old text back');

// Text objects.
eq(after('one two three', 'wdiw'), 'one  three');
eq(after('one two three', 'wdaw'), 'one three');
eq(after('one two three', '$daw'), 'one two', 'the last word: with the blank before it');
eq(after('say "hello there" now', 'fhdi"'), 'say "" now');
eq(after('say "hello there" now', 'fhda"'), 'say now');
eq(after('f(a, (b), c)', 'fadi('), 'f()');
eq(after('f(a, (b), c)', 'fbdi('), 'f(a, (), c)', 'the innermost pair');
eq(after('f(a, (b), c)', 'fada('), 'f');
eq(after('x[1, 2]', 'f1ci[9<Esc>'), 'x[9]');
eq(after('a\nb\n\nc', 'dap'), 'c');
eq(after('a\nb\n\nc', 'dip'), '|c');

// Undo: an operator (and a change that went on in Insert mode) is one step.
e = open('one two three');
type(e, 'dwu');
eq(lines(e), 'one two three');
type(e, 'cwXY<Esc>u');
eq(lines(e), 'one two three');

// ── Registers and putting ───────────────────────────────────────────────────────────────────────────────────────────

eq(after('a\nb', 'yyp'), 'a|a|b');
eq(after('a\nb', 'yyP'), 'a|a|b');
eq(after('a\nb', 'jyy2P'), 'a|b|b|b');
eq(after('one two', 'ywP'), 'one one two');
eq(after('one two', 'yw$p'), 'one twoone ');
eq(after('abc', 'xp'), 'bac', 'xp swaps two characters');
eq(after('a\nb', 'ddp'), 'b|a', 'ddp swaps two lines');
eq(after('one two', '"ayiww"byiw"ap"bp'), 'one tonetwowo', 'named registers: "one" after the t, "two" after that');
eq(after('a\nb\nc', '"Ayyj"Ayyj"ap'), 'a|b|c|a|b', '"A appends');
eq(after('a\nb\nc', 'dddd"2p'), 'c|a', '"1, "2: the deletions of lines, newest first');
eq(after('x\ny', 'yy"_ddp'), 'y|x', '"_ keeps the other registers');
e = open('abc');
type(e, '"qp');
eq(e.message, 'E353: Nothing in register q');

// ── Repeat ──────────────────────────────────────────────────────────────────────────────────────────────────────────

eq(after('a b c d', 'dw.'), 'c d');
eq(after('a b c d e f', 'dw2.'), 'd e f', 'a count for . replaces the original');
eq(after('one two three', 'ciwX<Esc>w.'), 'X X three', '. repeats a change with what was typed');
eq(after('a\nb\nc', 'A!<Esc>j.j.'), 'a!|b!|c!');
eq(after('abcdef', '2x.'), 'ef');
eq(after('', '3ix<Esc>'), 'xxx', 'a count repeats what Insert typed');
eq(after('a', '2ob<Esc>'), 'a|b|b');
eq(after('a', 'ox<Esc>.'), 'a|x|x');

// Insert mode keys: Ctrl+W deletes the word before the cursor, Ctrl+U the line before it, Ctrl+Left / Right jump.
eq(after('', 'ione two<C-w>X<Esc>'), 'one X');
eq(after('', 'ione two<C-u>X<Esc>'), 'X');
eq(after('one two', 'A<C-Left>X<Esc>'), 'one Xtwo');

