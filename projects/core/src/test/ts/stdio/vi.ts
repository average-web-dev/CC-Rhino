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
    readonly command: string;
    readonly message: string;
    readonly error: boolean;
    readonly quit: boolean;
    readonly path: string | undefined;
    readonly top: number;
    readonly registers: { get(name?: string): { text: string; linewise: boolean } | undefined };
    setSize(width: number, rows: number): void;
    handleKey(key: TtyKeyInput): void;
    handlePaste(text: string): void;
    handleMouse(mouse: TtyMouseInput): void;
    now: () => number;
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
    '<C-v>': '\x16',
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


// ── Visual mode (phase 3) ───────────────────────────────────────────────────────────────────────────────────────────

e = open('one two three');
type(e, 'wv');
eq(e.mode, 'visual');
type(e, '<Esc>');
eq(e.mode, 'normal');

eq(after('one two three', 'wvlld'), 'one  three');
eq(after('one two three', 'wviwd'), 'one  three', 'a text object selects it');
eq(after('one two three', 'wvawd'), 'one three');
eq(after('abcdef', 'lvllohd'), 'ef', 'o moves the other end');
eq(after('one two', 'vey$p'), 'one twoone');
eq(after('a\nb\nc', 'Vjd'), 'c');
eq(after('a\nb\nc', 'Vj>'), '    a|    b|c');
eq(after('a\nb\nc', 'Vj2>'), '        a|        b|c', 'a count shifts that often');
eq(after('abcd', 'vll~'), 'ABCd');
eq(after('ABC\nDEF', 'Vju'), 'abc|def');
eq(after('abcd', 'vllU'), 'ABCd');
eq(after('abcd', 'vllrx'), 'xxxd');
eq(after('a\nb\nc', 'VjJ'), 'a b|c');
eq(after('one two', 'yiwwviwp'), 'one one', 'p replaces the selection');
eq(after('one two', 'yiwwviwp0viwp'), 'two one', '…and keeps what it replaced in the unnamed register');
eq(after('a\nb\nc', 'yyjVp'), 'a|a|c', 'lines replace lines');
eq(after('abcd', 'vly<Esc>gvd'), 'cd', 'gv selects the last selection again');
eq(after('abcd', 'vlcX<Esc>'), 'Xcd');
eq(after('a\nb\nc', 'VjcX<Esc>'), 'X|c');
e = open('abc');
type(e, 'vl:');
eq(`${e.mode} ${e.command}`, "command '<,'>", ': in Visual mode starts with the range of the selection');

// Visual block.
eq(after('abcd\nefgh\nijkl', '<C-v>jld'), 'cd|gh|ijkl');
eq(after('abcd\nefgh\nijkl', '<C-v>jIX<Esc>'), 'Xabcd|Xefgh|ijkl', 'I types into every line of the block');
eq(after('abcd\nefgh\nijkl', 'l<C-v>jAY<Esc>'), 'abYcd|efYgh|ijkl');
eq(after('abcd\nefgh\nijkl', '<C-v>jlcZ<Esc>'), 'Zcd|Zgh|ijkl');
eq(after('ab\ncdef', '<C-v>j$A!<Esc>'), 'ab!|cdef!', 'after $: the end of every line');
eq(after('abcdef\nab', 'llll<C-v>jAZ<Esc>'), 'abcdeZf|ab   Z', 'A pads short lines');
eq(after('abcd\nefgh\nijkl', '<C-v>jly$p'), 'abcdab|efghef|ijkl', 'a block is put as a block');
eq(after('abcd\nefgh', '<C-v>jlU'), 'ABcd|EFgh');
eq(after('abcd\nefgh', 'l<C-v>jlrx'), 'axxd|exxh');
eq(after('abcd\nefgh', '<C-v>jlO'.replace('O', 'Od')), 'cd|gh', 'O: the other corner');

// '.' repeats a Visual change on as much text, from the cursor.
eq(after('abcdef', 'vld.'), 'ef');
eq(after('a\nb\nc', 'Vd.'), 'c');
eq(after('abcd\nefgh\nijkl', '<C-v>jIX<Esc>j.'), 'Xabcd|XXefgh|Xijkl');

// ── Mouse ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A mouse report as the terminal sends it (SGR encoding; x and y from 0, as the screen cells). */
function mouse(editor: Editor, kind: 'press' | 'release' | 'drag' | 'up' | 'down', x: number, y: number): void {
    let code = kind === 'drag' ? 32 : kind === 'up' ? 64 : kind === 'down' ? 65 : 0;
    let sequence = `\x1b[<${code};${x + 1};${y + 1}${kind === 'release' ? 'm' : 'M'}`;
    for (let input of decodeInput(sequence)) if (input.type === 'mouse') editor.handleMouse(input);
}
let clock = 0;
function clicked(text: string): Editor {
    let editor = open(text);
    editor.now = () => clock;
    clock += 10000;
    return editor;
}
function click(editor: Editor, x: number, y: number): void {
    mouse(editor, 'press', x, y);
    mouse(editor, 'release', x, y);
}

e = clicked('one two three\nfour');
click(e, 5, 0);
eq(at(e), '0,5', 'a click puts the cursor there');
click(e, 9, 1);
eq(at(e), '1,3', 'past the end of a line: its last character');
click(e, 2, 3);
eq(at(e), '1,2', "below the text ('~'): the last line");
click(e, 2, 5);
eq(at(e), '1,2', 'the last row (status, command line) is no text');
type(e, 'A');
click(e, 2, 0);
eq(`${e.mode} ${at(e)}`, 'insert 0,2', 'Insert mode stays');
type(e, '<Esc>');

e = clicked('one two three\nfour');
mouse(e, 'press', 0, 0);
mouse(e, 'drag', 3, 0);
mouse(e, 'drag', 6, 0);
mouse(e, 'release', 6, 0);
eq(e.mode, 'visual', 'dragging selects');
type(e, 'd');
eq(lines(e), ' three|four');

e = clicked('one two three\nfour');
type(e, 'A');
mouse(e, 'press', 4, 0);
mouse(e, 'drag', 6, 0);
eq(e.mode, 'visual', 'dragging in Insert mode leaves it for Visual mode');
type(e, 'y<Esc>');
eq(e.registers.get()?.text, 'two');

e = clicked('one two three\nfour');
click(e, 5, 0);
click(e, 5, 0);
eq(e.mode, 'visual', 'a double click selects the word');
type(e, 'd');
eq(lines(e), 'one  three|four');

e = clicked('one two three\nfour');
click(e, 5, 0);
click(e, 5, 0);
click(e, 5, 0);
type(e, 'd');
eq(lines(e), 'four', 'a triple click selects the line');

e = clicked('one two three\nfour');
click(e, 5, 0);
clock += 1000;
click(e, 5, 0);
eq(e.mode, 'normal', 'clicks far apart are two clicks');
click(e, 6, 0);
eq(e.mode, 'normal', 'and so are clicks on different cells');

e = clicked('one two');
type(e, 'vl');
click(e, 5, 0);
eq(`${e.mode} ${at(e)}`, 'normal 0,5', 'a click ends a selection');
type(e, 'gvd');
eq(lines(e), 'e two', '…which gv brings back');

e = clicked(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
mouse(e, 'down', 0, 0);
eq(`${e.top} ${at(e)}`, '3 3,0', 'the wheel scrolls three lines; the cursor stays on screen');
mouse(e, 'down', 0, 0);
mouse(e, 'up', 0, 0);
eq(`${e.top} ${at(e)}`, '3 6,0', 'scrolling back keeps the cursor where it is, if shown');
