// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/normal.ts — vi's Normal mode: commands are typed as key sequences
//
//   ["x] [count] command                     x, p, J, r{c}, i, o, u, . …
//   ["x] [count] motion                      w, 3j, f(, gg …
//   ["x] [count] operator [count] motion     d2w, c$, yG, >}, gUiw …
//   ["x] [count] operator operator           dd, 3yy, >>, g~~ (whole lines)
//   ["x] [count] operator i|a object         diw, ca", yi(, dap
//
// keys are collected until a sequence is complete (the bottom row shows them), then it runs. A command that changes
// text is one undo step, and '.' repeats the last one (its keys, including what was typed in Insert mode).

import { before, type Position } from '/rom/lib/internal/vi/buffer';
import type { Editor } from '/rom/lib/internal/vi/editor';
import { execute } from '/rom/lib/internal/vi/ex';
import {
    firstNonBlank, motionName, motionTakesArg, runMotion, textObject, type MotionContext, type Target,
} from '/rom/lib/internal/vi/motions';
import { isRegisterName } from '/rom/lib/internal/vi/registers';

/** Operators: they change the text a motion or object covers (doubled: whole lines). */
const OPERATORS = new Set(['d', 'c', 'y', '>', '<', 'g~', 'gu', 'gU']);

/** Commands that change the text, for '.' (the operators d, c, >, <, g~, gu, gU count too; y does not). */
const CHANGES = new Set(['x', 'X', 's', 'S', 'D', 'C', 'p', 'P', 'J', 'gJ', '~', 'r', 'i', 'a', 'I', 'A', 'o', 'O',
    'R', '<Del>', '<Insert>']);

/** Commands of their own (no motion). */
const COMMANDS = new Set([...CHANGES, 'Y', 'u', '<C-r>', '.', ':', 'ZZ', 'ZQ', '<C-c>', '<Esc>', '<PageDown>',
    '<PageUp>', '<C-f>', '<C-b>', '<C-d>', '<C-u>', '<C-e>', '<C-y>']);

/** Commands that take a character after them. */
const TAKES_CHAR = new Set(['r']);

/** The width of one shift (> and <). */
const SHIFT = '    ';

/** A complete command, parsed from its keys. */
interface Command {
    register?: string;
    /** The count before the command times the one before the motion (undefined: none typed). */
    count?: number;
    /** A command of its own, an operator, or a motion. */
    name: string;
    /** The operator's motion, or 'line' for a doubled operator (dd). */
    motion?: string;
    /** The text object after an operator: around (a) or inner (i), and which. */
    object?: { around: boolean; kind: string };
    /** The character after f / t / F / T / r. */
    arg?: string;
}

const INCOMPLETE = 'incomplete';
const INVALID = 'invalid';

/** Read a count at keys[i] (digits, not starting with 0). */
function readCount(keys: string[], i: number): [number | undefined, number] {
    if (i >= keys.length || !/^[1-9]$/.test(keys[i])) return [undefined, i];
    let n = 0;
    while (i < keys.length && /^[0-9]$/.test(keys[i])) n = n * 10 + Number(keys[i++]);
    return [n, i];
}

/** Parse the keys typed so far into a command. */
function parse(keys: string[]): Command | typeof INCOMPLETE | typeof INVALID {
    let i = 0;
    let register: string | undefined;
    if (keys[0] === '"') {
        if (keys.length < 2) return INCOMPLETE;
        if (!isRegisterName(keys[1])) return INVALID;
        register = keys[1];
        i = 2;
    }
    let [count1, afterCount] = readCount(keys, i);
    i = afterCount;
    if (i >= keys.length) return INCOMPLETE;
    let name = keys[i++];
    if (name === 'g' || name === 'Z') {
        if (i >= keys.length) return INCOMPLETE;
        name += keys[i++];
    }
    let multiply = (count2: number | undefined) =>
        count1 === undefined && count2 === undefined ? undefined : (count1 ?? 1) * (count2 ?? 1);

    if (OPERATORS.has(name)) {
        let [count2, at] = readCount(keys, i);
        i = at;
        if (i >= keys.length) return INCOMPLETE;
        let key = keys[i++];
        // Doubled: dd, yy, >>, g~~ / g~g~, guu / gugu, gUU / gUgU.
        let last = name.charAt(name.length - 1);
        if (key === last || (name.length === 2 && key === 'g' && keys[i] === last)) {
            return { register, count: multiply(count2), name, motion: 'line' };
        }
        if (key === 'g' && i >= keys.length) return INCOMPLETE;
        if (key === 'i' || key === 'a') {
            if (i >= keys.length) return INCOMPLETE;
            return { register, count: multiply(count2), name, object: { around: key === 'a', kind: keys[i] } };
        }
        if (key === 'g') key += keys[i++];
        let motion = motionName(key);
        if (motion === undefined) return INVALID;
        if (motionTakesArg(motion)) {
            if (i >= keys.length) return INCOMPLETE;
            return { register, count: multiply(count2), name, motion, arg: keys[i] };
        }
        return { register, count: multiply(count2), name, motion };
    }
    let motion = motionName(name);
    if (motion !== undefined) {
        if (motionTakesArg(motion)) {
            if (i >= keys.length) return INCOMPLETE;
            return { register, count: count1, name: motion, arg: keys[i] };
        }
        return { register, count: count1, name: motion };
    }
    if (COMMANDS.has(name)) {
        if (TAKES_CHAR.has(name)) {
            if (i >= keys.length) return INCOMPLETE;
            return { register, count: count1, name, arg: keys[i] };
        }
        return { register, count: count1, name };
    }
    return INVALID;
}

/** A region of text: from `start` to `end` (exclusive), or the whole lines `start.line` to `end.line`. */
interface Region {
    start: Position;
    end: Position;
    linewise: boolean;
}

export class NormalMode {
    readonly #editor: Editor;
    #keys: string[] = [];
    /** The last change, for '.': its keys (without the count) and its count. */
    #dot: { keys: string[]; count: number | undefined } | undefined;
    /** The keys of a change that went on into Insert mode, recorded until Esc. */
    #recording: { keys: string[]; count: number | undefined } | undefined;
    #replaying = false;

    constructor(editor: Editor) {
        this.#editor = editor;
    }

    /** The keys typed so far of an incomplete command. */
    get pending(): string {
        return this.#keys.join('');
    }

    feed(key: string): void {
        if (key === '<Esc>' && this.#keys.length > 0) { this.#keys = []; return; }
        this.#keys.push(key);
        let command = parse(this.#keys);
        if (command === INCOMPLETE) return;
        let keys = this.#keys;
        this.#keys = [];
        if (command === INVALID) return;
        this.#run(command, keys);
    }

    /** A key typed in Insert / Replace mode (recorded for '.' while a change goes on there). */
    record(key: string): void {
        if (this.#recording !== undefined && !this.#replaying) this.#recording.keys.push(key);
    }

    /** Insert / Replace mode ended (Esc): the change that started it is complete. */
    insertDone(): void {
        if (this.#recording !== undefined && !this.#replaying) this.#dot = this.#recording;
        this.#recording = undefined;
    }

    #run(command: Command, keys: string[]): void {
        let editor = this.#editor;
        let isChange = CHANGES.has(command.name) || (OPERATORS.has(command.name) && command.name !== 'y');
        if (command.name === '.') { this.#repeat(command.count); return; }
        editor.buffer.begin(editor.cursor);
        try {
            if (OPERATORS.has(command.name)) this.#operate(command);
            else if (COMMANDS.has(command.name)) this.#command(command);
            else this.#move(command);
        } finally {
            if (editor.mode === 'normal') editor.buffer.end(editor.cursor);
        }
        if (!isChange || this.#replaying) return;
        // Remember it for '.' without its count (a count given to '.' replaces it).
        let [, afterCount] = readCount(keys, keys[0] === '"' ? 2 : 0);
        let body = keys[0] === '"' ? keys.slice(0, 2).concat(keys.slice(afterCount)) : keys.slice(afterCount);
        let entry = { keys: body, count: command.count };
        if (editor.mode === 'insert' || editor.mode === 'replace') this.#recording = entry;
        else this.#dot = entry;
    }

    /** '.': run the last change again (with `count`, if given, instead of its own). */
    #repeat(count: number | undefined): void {
        let dot = this.#dot;
        if (dot === undefined) return;
        let keys = [...dot.keys];
        let n = count ?? dot.count;
        if (n !== undefined) {
            let at = keys[0] === '"' ? 2 : 0;
            keys.splice(at, 0, ...String(n).split(''));
        }
        this.#replaying = true;
        try {
            for (let key of keys) this.#editor.feed(key);
            if (this.#editor.mode === 'insert' || this.#editor.mode === 'replace') this.#editor.feed('<Esc>');
        } finally {
            this.#replaying = false;
        }
        if (count !== undefined) this.#dot = { keys: dot.keys, count };
    }

    #context(command: Command, count = command.count): MotionContext {
        let editor = this.#editor;
        return {
            buffer: editor.buffer, cursor: editor.cursor, count: count ?? 1, counted: count !== undefined,
            arg: command.arg, want: editor.want, top: editor.top, rows: editor.rows, lastFind: editor.lastFind,
        };
    }

    // ── Motions ──────────────────────────────────────────────────────────────────────────────────────────────────────

    #target(command: Command): Target | undefined {
        let editor = this.#editor;
        let motion = command.motion ?? command.name;
        if (motion === 'f' || motion === 'F' || motion === 't' || motion === 'T') {
            editor.lastFind = { motion, char: command.arg! };
        }
        return runMotion(motion, this.#context(command));
    }

    #move(command: Command): void {
        let editor = this.#editor;
        let target = this.#target(command);
        if (target === undefined) return;
        let pos = editor.normalCol(target.pos);
        // A move that does not get anywhere (l on the last character) fails, keeping the column j / k aim for.
        if (pos.line === editor.cursor.line && pos.col === editor.cursor.col && target.kind !== 'linewise') return;
        editor.cursor = pos;
        if (target.want !== undefined) editor.want = target.want;
        else editor.wantHere();
    }

    // ── Operators ────────────────────────────────────────────────────────────────────────────────────────────────────

    /** The text an operator command covers, or undefined if its motion or object fails. */
    #region(command: Command): Region | undefined {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let cursor = editor.cursor;
        if (command.motion === 'line') {
            let last = Math.min(cursor.line + (command.count ?? 1) - 1, buffer.lineCount - 1);
            return { start: { line: cursor.line, col: 0 }, end: { line: last, col: 0 }, linewise: true };
        }
        if (command.object !== undefined) {
            return textObject(buffer, cursor, command.object.around, command.object.kind);
        }
        let target: Target | undefined;
        if (command.name === 'c' && (command.motion === 'w' || command.motion === 'W')
            && /\S/.test(buffer.line(cursor.line).charAt(cursor.col))) {
            // cw on a word changes to its end, like ce (and does not take the blanks after it).
            target = this.#changeWordEnd(command.motion === 'W', command.count ?? 1);
        } else {
            target = this.#target(command);
        }
        if (target === undefined) return undefined;
        if (target.kind === 'linewise') {
            let [a, b] = [cursor.line, target.pos.line].sort((x, y) => x - y);
            return { start: { line: a, col: 0 }, end: { line: b, col: 0 }, linewise: true };
        }
        let [start, end] = before(target.pos, cursor) ? [target.pos, cursor] : [cursor, target.pos];
        if (target.kind === 'inclusive') end = { line: end.line, col: Math.min(end.col + 1, buffer.line(end.line).length) };
        else if (end.line > start.line && buffer.line(end.line).slice(0, end.col).trim() === '') {
            let line = end.line - 1;
            if (command.motion === 'w' || command.motion === 'W') {
                // The last word moved over ends the text, not the next line's start (dw on a line's last word).
                end = { line, col: buffer.line(line).length };
            } else if (end.col === 0) {
                // An exclusive motion ending at a line's start stops at the end of the line before, and covers whole
                // lines if it started at or before the first non-blank (d} on a paragraph), as in vim.
                if (start.col <= firstNonBlank(buffer.line(start.line))) {
                    return { start: { line: start.line, col: 0 }, end: { line, col: 0 }, linewise: true };
                }
                end = { line, col: buffer.line(line).length };
            }
        }
        return { start, end, linewise: false };
    }

    /** cw / cW: the end of the word under the cursor (it may be the cursor), then of `count - 1` more. */
    #changeWordEnd(big: boolean, count: number): Target {
        let buffer = this.#editor.buffer;
        let { line, col } = this.#editor.cursor;
        let text = buffer.line(line);
        let cls = (ch: string) => (/\s/.test(ch) || ch === '' ? 0 : big || /\w/.test(ch) ? 1 : 2);
        let end = col;
        while (end + 1 < text.length && cls(text.charAt(end + 1)) === cls(text.charAt(col))) end++;
        let pos: Position = { line, col: end };
        if (count > 1) {
            let target = runMotion(big ? 'E' : 'e', { ...this.#context({ name: 'e' }, count - 1), cursor: pos });
            if (target !== undefined) pos = target.pos;
        }
        return { pos, kind: 'inclusive' };
    }

    #operate(command: Command): void {
        let editor = this.#editor;
        let region = this.#region(command);
        if (region === undefined) return;
        switch (command.name) {
            case 'y': this.#yank(region, command.register); break;
            case 'd': this.#delete(region, command.register); break;
            case 'c': this.#change(region, command.register); break;
            case '>': case '<': this.#shift(region, command.name === '>'); break;
            default: this.#changeCase(region, command.name); break;
        }
        if (editor.mode === 'normal') editor.cursor = editor.normalCol(editor.cursor);
    }

    /** The text of a region (whole lines joined with '\n' for a linewise one). */
    #text(region: Region): string {
        let buffer = this.#editor.buffer;
        if (!region.linewise) return buffer.slice(region.start, region.end);
        let lines: string[] = [];
        for (let i = region.start.line; i <= region.end.line; i++) lines.push(buffer.line(i));
        return lines.join('\n');
    }

    #yank(region: Region, register: string | undefined): void {
        let editor = this.#editor;
        editor.registers.yank(register, { text: this.#text(region), linewise: region.linewise });
        if (region.linewise) {
            if (region.start.line !== editor.cursor.line) editor.cursor = { line: region.start.line, col: editor.cursor.col };
        } else {
            editor.cursor = region.start;
        }
    }

    #delete(region: Region, register: string | undefined): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        editor.registers.delete(register, { text: this.#text(region), linewise: region.linewise });
        if (!region.linewise) {
            buffer.delete(region.start, region.end, editor.cursor);
            editor.cursor = region.start;
            editor.wantHere();
            return;
        }
        let first = region.start.line;
        let last = region.end.line;
        let lastEnd = { line: last, col: buffer.line(last).length };
        if (last < buffer.lineCount - 1) {
            buffer.delete({ line: first, col: 0 }, { line: last + 1, col: 0 }, editor.cursor);
        } else if (first > 0) {
            // The last lines: their line break before them goes too.
            buffer.delete({ line: first - 1, col: buffer.line(first - 1).length }, lastEnd, editor.cursor);
        } else {
            buffer.delete({ line: 0, col: 0 }, lastEnd, editor.cursor);
        }
        editor.gotoLine(Math.min(first, buffer.lineCount - 1));
    }

    #change(region: Region, register: string | undefined): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        editor.registers.delete(register, { text: this.#text(region), linewise: region.linewise });
        if (region.linewise) {
            // The lines become one empty line (keeping the first one's indent), where typing starts.
            let first = region.start.line;
            let indent = /^\s*/.exec(buffer.line(first))![0];
            let last = region.end.line;
            buffer.delete({ line: first, col: 0 }, { line: last, col: buffer.line(last).length }, editor.cursor);
            buffer.insert({ line: first, col: 0 }, indent);
            editor.startInsert({ line: first, col: indent.length });
            return;
        }
        buffer.delete(region.start, region.end, editor.cursor);
        editor.startInsert(region.start);
    }

    #shift(region: Region, right: boolean): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        for (let line = region.start.line; line <= region.end.line; line++) {
            let text = buffer.line(line);
            if (right) {
                if (text !== '') buffer.insert({ line, col: 0 }, SHIFT);
            } else {
                let remove = text.startsWith('\t') ? 1 : /^ {0,4}/.exec(text)![0].length;
                if (remove > 0) buffer.delete({ line, col: 0 }, { line, col: remove });
            }
        }
        editor.gotoLine(region.start.line);
    }

    #changeCase(region: Region, operator: string): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let start = region.linewise ? { line: region.start.line, col: 0 } : region.start;
        let end = region.linewise ? { line: region.end.line, col: buffer.line(region.end.line).length } : region.end;
        let text = buffer.slice(start, end);
        let changed = operator === 'gu' ? text.toLowerCase() : operator === 'gU' ? text.toUpperCase() : toggleCase(text);
        if (changed !== text) {
            buffer.delete(start, end, editor.cursor);
            buffer.insert(start, changed);
        }
        editor.cursor = region.linewise ? { line: start.line, col: editor.cursor.col } : start;
    }

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────────────────

    #command(command: Command): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let count = command.count ?? 1;
        let { line, col } = editor.cursor;
        let text = buffer.line(line);
        let as = (name: string, motion: string) => this.#operate({ ...command, name, motion });
        switch (command.name) {
            case 'x': case '<Del>': if (text.length > 0) as('d', 'l'); return;
            case 'X': if (col > 0) as('d', 'h'); return;
            case 's': if (text.length > 0) as('c', 'l'); else editor.startInsert(editor.cursor); return;
            case 'S': as('c', 'line'); return;
            case 'D': as('d', '$'); return;
            case 'C': as('c', '$'); return;
            case 'Y': as('y', 'line'); return;
            case 'p': case 'P': this.#put(command.register, count, command.name === 'p'); return;
            case 'J': case 'gJ': this.#join(Math.max(2, count), command.name === 'J'); return;
            case '~': {
                let end = Math.min(col + count, text.length);
                if (end > col) {
                    this.#changeCase({ start: { line, col }, end: { line, col: end }, linewise: false }, '~');
                    editor.cursor = editor.normalCol({ line, col: end });
                }
                return;
            }
            case 'r': this.#replaceChars(command.arg!, count); return;
            case 'i': case '<Insert>': editor.startInsert(editor.cursor, 'insert', count); return;
            case 'a': editor.startInsert({ line, col: Math.min(col + 1, text.length) }, 'insert', count); return;
            case 'I': editor.startInsert({ line, col: firstNonBlank(text) }, 'insert', count); return;
            case 'A': editor.startInsert({ line, col: text.length }, 'insert', count); return;
            case 'o':
                editor.startInsert(buffer.insert({ line, col: text.length }, '\n', editor.cursor), 'insert', count, '\n');
                return;
            case 'O':
                buffer.insert({ line, col: 0 }, '\n', editor.cursor);
                editor.startInsert({ line, col: 0 }, 'insert', count, '');
                return;
            case 'R': editor.startInsert(editor.cursor, 'replace', count); return;
            case 'u': case '<C-r>': {
                let redo = command.name === '<C-r>';
                let pos: Position | undefined;
                for (let i = 0; i < count; i++) {
                    let next = redo ? buffer.redo() : buffer.undo();
                    if (next === undefined) break;
                    pos = next;
                }
                if (pos === undefined) {
                    editor.message = redo ? 'Already at newest change' : 'Already at oldest change';
                    return;
                }
                editor.cursor = editor.normalCol(pos);
                editor.wantHere();
                return;
            }
            case ':': editor.mode = 'command'; editor.command = ''; return;
            case 'ZZ': execute(editor, 'x'); return;
            case 'ZQ': execute(editor, 'q!'); return;
            case '<C-c>': editor.message = 'Type  :q!  and press <Enter> to abandon all changes and exit vi'; return;
            case '<PageDown>': case '<C-f>': this.#scroll(count * Math.max(1, editor.rows - 2), true); return;
            case '<PageUp>': case '<C-b>': this.#scroll(-count * Math.max(1, editor.rows - 2), true); return;
            case '<C-d>': this.#scroll(Math.max(1, Math.floor(editor.rows / 2)), true); return;
            case '<C-u>': this.#scroll(-Math.max(1, Math.floor(editor.rows / 2)), true); return;
            case '<C-e>': this.#scroll(count, false); return;
            case '<C-y>': this.#scroll(-count, false); return;
            default:
        }
    }

    /** Scroll the view by `lines`; the cursor moves along (`withCursor`) or just stays on screen. */
    #scroll(lines: number, withCursor: boolean): void {
        let editor = this.#editor;
        let last = editor.buffer.lineCount - 1;
        editor.top = Math.max(0, Math.min(editor.top + lines, last));
        let line = withCursor ? editor.cursor.line + lines : editor.cursor.line;
        line = Math.max(editor.top, Math.min(line, editor.top + editor.rows - 1, last));
        editor.cursor = editor.normalCol({ line, col: editor.wantedCol(line) });
    }

    /** p / P: the register's text after / before the cursor (its lines below / above the cursor's line). */
    #put(register: string | undefined, count: number, after: boolean): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let value = editor.registers.get(register ?? '"');
        if (value === undefined) {
            editor.fail(`E353: Nothing in register ${register ?? '"'}`);
            return;
        }
        let { line, col } = editor.cursor;
        if (value.linewise) {
            let lines = Array(count).fill(value.text).join('\n');
            if (after) {
                buffer.insert({ line, col: buffer.line(line).length }, '\n' + lines, editor.cursor);
                editor.gotoLine(line + 1);
            } else {
                buffer.insert({ line, col: 0 }, lines + '\n', editor.cursor);
                editor.gotoLine(line);
            }
            return;
        }
        let text = value.text.repeat(count);
        let at = after && buffer.line(line).length > 0 ? { line, col: col + 1 } : { line, col };
        let end = buffer.insert(at, text, editor.cursor);
        editor.cursor = text.indexOf('\n') >= 0 ? at : editor.normalCol({ line: end.line, col: end.col - 1 });
        editor.wantHere();
    }

    /** J / gJ: join `count` lines; J removes the next line's indent and puts one space between (none before ')'). */
    #join(count: number, spaces: boolean): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let line = editor.cursor.line;
        if (line + 1 >= buffer.lineCount) return;
        let joinCol = 0;
        for (let i = 1; i < count && line + 1 < buffer.lineCount; i++) {
            let current = buffer.line(line);
            let nextText = buffer.line(line + 1);
            let indent = spaces ? /^\s*/.exec(nextText)![0].length : 0;
            let rest = nextText.slice(indent);
            let gap = !spaces || rest === '' || /\s$/.test(current) || rest.startsWith(')') || current === '' ? '' : ' ';
            buffer.delete({ line, col: current.length }, { line: line + 1, col: indent }, editor.cursor);
            if (gap !== '') buffer.insert({ line, col: current.length }, gap);
            joinCol = current.length;
        }
        editor.cursor = editor.normalCol({ line, col: joinCol });
        editor.wantHere();
    }

    /** r{c}: replace `count` characters with c (r<CR> breaks the line instead). */
    #replaceChars(char: string, count: number): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let { line, col } = editor.cursor;
        if (col + count > buffer.line(line).length || char === '<Esc>') return;
        if (char === '<CR>') {
            buffer.delete({ line, col }, { line, col: col + count }, editor.cursor);
            buffer.insert({ line, col }, '\n');
            editor.cursor = { line: line + 1, col: 0 };
            return;
        }
        if (Array.from(char).length !== 1) return;
        buffer.delete({ line, col }, { line, col: col + count }, editor.cursor);
        buffer.insert({ line, col }, char.repeat(count));
        editor.cursor = { line, col: col + count - 1 };
        editor.wantHere();
    }
}

function toggleCase(text: string): string {
    let out = '';
    for (let ch of text) {
        let upper = ch.toUpperCase();
        out += ch === upper ? ch.toLowerCase() : upper;
    }
    return out;
}
