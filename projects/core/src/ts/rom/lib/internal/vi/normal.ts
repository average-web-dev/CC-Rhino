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
//
// Visual mode (v, V, Ctrl+V; gv selects the last selection again): motions, counts and text objects move the cursor
// end of the selection (o / O the other end), and commands act on it: d x X D y Y c s C S R > < ~ u U J gJ r p P,
// I / A in a block (typed into each of its lines), ':' with the range '<,'>.

import { before, type Position } from '/rom/lib/internal/vi/buffer';
import { isCharKey, type Editor, type Selection, type VisualKind } from '/rom/lib/internal/vi/editor';
import { execute } from '/rom/lib/internal/vi/ex';
import {
    firstNonBlank, motionName, motionTakesArg, runMotion, textObject, type MotionContext, type Target,
} from '/rom/lib/internal/vi/motions';
import { isRegisterName, type Register } from '/rom/lib/internal/vi/registers';
import { wordPattern } from '/rom/lib/internal/vi/search';
import { colAtDisplay, displayCol } from '/rom/lib/internal/vi/tabs';

/** Operators: they change the text a motion or object covers (doubled: whole lines). */
const OPERATORS = new Set(['d', 'c', 'y', '>', '<', 'g~', 'gu', 'gU']);

/** Commands that change the text, for '.' (the operators d, c, >, <, g~, gu, gU count too; y does not). */
const CHANGES = new Set(['x', 'X', 's', 'S', 'D', 'C', 'p', 'P', 'J', 'gJ', '~', 'r', 'i', 'a', 'I', 'A', 'o', 'O',
    'R', '<Del>', '<Insert>']);

/** Commands of their own (no motion). */
const COMMANDS = new Set([...CHANGES, 'Y', 'u', '<C-r>', '.', ':', 'ZZ', 'ZQ', '<C-c>', '<Esc>', '<PageDown>',
    '<PageUp>', '<C-f>', '<C-b>', '<C-d>', '<C-u>', '<C-e>', '<C-y>', 'v', 'V', '<C-v>', 'gv', '/', '?', 'n', 'N', '*',
    '#']);

/** What Visual mode does with the selection (besides moving its end). */
const VISUAL_COMMANDS = new Set(['d', 'x', '<Del>', 'X', 'D', 'y', 'Y', 'c', 's', 'C', 'S', 'R', '>', '<', '~', 'u',
    'U', 'g~', 'gu', 'gU', 'J', 'gJ', 'r', 'p', 'P', 'o', 'O', 'I', 'A', ':', 'v', 'V', '<C-v>', '<Esc>', '<C-c>',
    'n', 'N', '*', '#', '/', '?']);

/** Visual commands that change the text (for '.'). */
const VISUAL_CHANGES = new Set(['d', 'x', '<Del>', 'X', 'D', 'c', 's', 'C', 'S', 'R', '>', '<', '~', 'u', 'U', 'g~',
    'gu', 'gU', 'J', 'gJ', 'r', 'p', 'P', 'I', 'A']);

/** The key that starts each kind of Visual mode. */
const VISUAL_KEYS: Record<VisualKind, string> = { char: 'v', line: 'V', block: '<C-v>' };

/** Commands that take a character after them. */
const TAKES_CHAR = new Set(['r']);

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

/** Parse the keys typed so far in Visual mode: a command, a motion, or i / a and a text object. */
function parseVisual(keys: string[]): Command | typeof INCOMPLETE | typeof INVALID {
    let i = 0;
    let register: string | undefined;
    if (keys[0] === '"') {
        if (keys.length < 2) return INCOMPLETE;
        if (!isRegisterName(keys[1])) return INVALID;
        register = keys[1];
        i = 2;
    }
    let [count, afterCount] = readCount(keys, i);
    i = afterCount;
    if (i >= keys.length) return INCOMPLETE;
    let name = keys[i++];
    if (name === 'g') {
        if (i >= keys.length) return INCOMPLETE;
        name += keys[i++];
    }
    if (name === 'i' || name === 'a') {
        if (i >= keys.length) return INCOMPLETE;
        return { register, count, name: 'object', object: { around: name === 'a', kind: keys[i] } };
    }
    if (VISUAL_COMMANDS.has(name)) {
        if (name === 'r') {
            if (i >= keys.length) return INCOMPLETE;
            return { register, count, name, arg: keys[i] };
        }
        return { register, count, name };
    }
    if (name === 'gv') return { register, count, name };
    let motion = motionName(name);
    if (motion === undefined) return INVALID;
    if (motionTakesArg(motion)) {
        if (i >= keys.length) return INCOMPLETE;
        return { register, count, name: motion, arg: keys[i] };
    }
    return { register, count, name: motion };
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
        if (target.kind === 'inclusive') {
            end = { line: end.line, col: Math.min(end.col + 1, buffer.line(end.line).length) };
        }
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
            if (region.start.line !== editor.cursor.line) {
                editor.cursor = { line: region.start.line, col: editor.cursor.col };
            }
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
        editor.removeLines(region.start.line, region.end.line);
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
        this.#editor.shiftLines(region.start.line, region.end.line, right, 1);
    }

    #changeCase(region: Region, operator: string): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let start = region.linewise ? { line: region.start.line, col: 0 } : region.start;
        let end = region.linewise ? { line: region.end.line, col: buffer.line(region.end.line).length } : region.end;
        let text = buffer.slice(start, end);
        let changed = operator === 'gu' ? text.toLowerCase()
            : operator === 'gU' ? text.toUpperCase() : toggleCase(text);
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
                let below = buffer.insert({ line, col: text.length }, '\n', editor.cursor);
                editor.startInsert(below, 'insert', count, '\n');
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
            case ':': editor.startCommand(':'); return;
            case '/': case '?': editor.startCommand(command.name as '/' | '?'); return;
            case 'n': case 'N': editor.searchAgain(command.name === 'N', count); return;
            case '*': case '#': this.#searchWord(command.name === '*', count); return;
            case 'v': this.#startVisual('char'); return;
            case 'V': this.#startVisual('line'); return;
            case '<C-v>': this.#startVisual('block'); return;
            case 'gv': {
                let last = editor.lastVisual;
                if (last === undefined) return;
                editor.visual = { kind: last.kind, anchor: editor.buffer.clamp(last.anchor) };
                editor.cursor = editor.normalCol(last.cursor);
                editor.mode = 'visual';
                return;
            }
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

    /** * / #: search for the word under the cursor, forward / backward. */
    #searchWord(forward: boolean, count: number): void {
        let editor = this.#editor;
        let pattern = wordPattern(editor.buffer.line(editor.cursor.line), editor.cursor.col);
        if (pattern === undefined) { editor.fail('E348: No string under cursor'); return; }
        editor.search(pattern, forward, count);
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
        let value = this.#editor.registers.get(register ?? '"');
        if (value === undefined) {
            this.#editor.fail(`E353: Nothing in register ${register ?? '"'}`);
            return;
        }
        this.#putValue(value, count, after);
    }

    /** Put `value` `count` times after / before the cursor (lines below / above, a block as a column). */
    #putValue(value: Register, count: number, after: boolean): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let { line, col } = editor.cursor;
        if (value.block) {
            let start = after && buffer.line(line).length > 0 ? col + 1 : col;
            let x = displayCol(buffer.line(line), start);
            let pieces = value.text.split('\n');
            let width = Math.max(...pieces.map((piece) => piece.length));
            pieces.forEach((piece, i) => {
                let target = line + i;
                if (target >= buffer.lineCount) {
                    buffer.insert({ line: target - 1, col: buffer.line(target - 1).length }, '\n');
                }
                let text = buffer.line(target);
                let shown = displayCol(text, text.length);
                if (shown < x) buffer.insert({ line: target, col: text.length }, ' '.repeat(x - shown));
                let at = colAtDisplay(buffer.line(target), x);
                buffer.insert({ line: target, col: at }, piece.padEnd(width).repeat(count));
            });
            editor.cursor = { line, col: colAtDisplay(buffer.line(line), x) };
            editor.wantHere();
            return;
        }
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

    /** J / gJ: join `count` lines from the cursor's. */
    #join(count: number, spaces: boolean): void {
        let line = this.#editor.cursor.line;
        this.#editor.joinLines(line, line + count - 1, spaces);
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

    // ── Visual mode ──────────────────────────────────────────────────────────────────────────────────────────────────

    #startVisual(kind: VisualKind): void {
        this.#editor.startVisual(kind, this.#editor.cursor);
    }

    #endVisual(): void {
        this.#editor.endVisual();
    }

    /** Forget the keys of an incomplete command (a mouse click came in between). */
    clear(): void {
        this.#keys = [];
    }

    /** A key in Visual mode. */
    feedVisual(key: string): void {
        if (key === '<Esc>' && this.#keys.length > 0) { this.#keys = []; return; }
        this.#keys.push(key);
        let command = parseVisual(this.#keys);
        if (command === INCOMPLETE) return;
        let keys = this.#keys;
        this.#keys = [];
        if (command === INVALID) return;
        let editor = this.#editor;
        if (command.name === 'object') { this.#selectObject(command); return; }
        if (!VISUAL_COMMANDS.has(command.name) && command.name !== 'gv') { this.#move(command); return; }
        let selection = editor.selection()!;
        let select = selectionKeys(selection);
        editor.buffer.begin(editor.cursor);
        try {
            this.#visualCommand(command, selection);
        } finally {
            if (editor.mode === 'normal') editor.buffer.end(editor.cursor);
        }
        if (!VISUAL_CHANGES.has(command.name) || this.#replaying) return;
        let entry = { keys: [...select, ...keys], count: undefined };
        if (editor.mode === 'insert' || editor.mode === 'replace') this.#recording = entry;
        else this.#dot = entry;
    }

    /** iw, a( … in Visual mode: select the object (or, with more already selected, extend to it). */
    #selectObject(command: Command): void {
        let editor = this.#editor;
        let visual = editor.visual!;
        let range = textObject(editor.buffer, editor.cursor, command.object!.around, command.object!.kind);
        if (range === undefined) return;
        let single = visual.anchor.line === editor.cursor.line && visual.anchor.col === editor.cursor.col;
        if (range.linewise) {
            visual.kind = 'line';
            if (single) visual.anchor = range.start;
            editor.cursor = { line: range.end.line, col: 0 };
        } else {
            if (single) visual.anchor = range.start;
            let end = range.end;
            editor.cursor = end.col > 0 ? { line: end.line, col: end.col - 1 }
                : { line: end.line - 1, col: Math.max(0, editor.buffer.line(end.line - 1).length - 1) };
        }
        editor.wantHere();
    }

    /** The selection as a region (whole lines for V; a block is handled column by column). */
    #selectionRegion(selection: Selection): Region {
        let buffer = this.#editor.buffer;
        if (selection.kind === 'line') {
            let { start, end } = selection;
            return { start: { line: start.line, col: 0 }, end: { line: end.line, col: 0 }, linewise: true };
        }
        let { line, col } = selection.end;
        let length = buffer.line(line).length;
        // The last character is selected too; on an empty line (or past the end) that is the line break.
        let end = col < length ? { line, col: col + 1 }
            : line < buffer.lineCount - 1 ? { line: line + 1, col: 0 } : { line, col: length };
        return { start: selection.start, end, linewise: false };
    }

    /** The columns a block covers on `line`: [from, to). */
    #blockCols(selection: Selection, line: number): [number, number] {
        let text = this.#editor.buffer.line(line);
        if (displayCol(text, text.length) <= selection.left) return [text.length, text.length];
        let from = colAtDisplay(text, selection.left);
        let to = selection.right === Infinity ? text.length
            : Math.min(text.length, colAtDisplay(text, selection.right) + 1);
        return [from, Math.max(from, to)];
    }

    #blockText(selection: Selection): string {
        let buffer = this.#editor.buffer;
        let pieces: string[] = [];
        for (let line = selection.start.line; line <= selection.end.line; line++) {
            let [from, to] = this.#blockCols(selection, line);
            pieces.push(buffer.line(line).slice(from, to));
        }
        return pieces.join('\n');
    }

    /** Replace each line's part of the block with `change(part)`. */
    #blockEach(selection: Selection, change: (part: string) => string): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        for (let line = selection.start.line; line <= selection.end.line; line++) {
            let [from, to] = this.#blockCols(selection, line);
            let part = buffer.line(line).slice(from, to);
            let changed = change(part);
            if (changed === part) continue;
            buffer.delete({ line, col: from }, { line, col: to }, editor.cursor);
            buffer.insert({ line, col: from }, changed);
        }
        let [first] = this.#blockCols(selection, selection.start.line);
        editor.cursor = { line: selection.start.line, col: first };
    }

    #visualCommand(command: Command, selection: Selection): void {
        let editor = this.#editor;
        let visual = editor.visual!;
        let name = command.name;
        let count = command.count ?? 1;
        let block = selection.kind === 'block';
        switch (name) {
            case '<Esc>': case '<C-c>': this.#endVisual(); return;
            case 'v': case 'V': case '<C-v>': {
                let kind: VisualKind = name === 'v' ? 'char' : name === 'V' ? 'line' : 'block';
                if (visual.kind === kind) this.#endVisual(); else visual.kind = kind;
                return;
            }
            case 'gv': return;
            case 'n': case 'N': editor.searchAgain(name === 'N', count); return;
            case '*': case '#': this.#searchWord(name === '*', count); return;
            case '/': case '?': editor.startCommand(name); return;
            case 'o': case 'O': {
                let anchor = visual.anchor;
                if (name === 'O' && block) {
                    // The other corner on the same lines.
                    let buffer = editor.buffer;
                    let xa = displayCol(buffer.line(anchor.line), anchor.col);
                    let xc = displayCol(buffer.line(editor.cursor.line), editor.cursor.col);
                    visual.anchor = { line: anchor.line, col: colAtDisplay(buffer.line(anchor.line), xc) };
                    let line = editor.cursor.line;
                    editor.cursor = { line, col: colAtDisplay(buffer.line(line), xa) };
                } else {
                    visual.anchor = editor.cursor;
                    editor.cursor = anchor;
                }
                editor.wantHere();
                return;
            }
            case ':':
                this.#endVisual();
                editor.startCommand(':', "'<,'>");
                return;
            default:
        }
        this.#endVisual();
        let region = this.#selectionRegion(selection);
        let lines: Region = {
            start: { line: selection.start.line, col: 0 }, end: { line: selection.end.line, col: 0 }, linewise: true,
        };
        let toEnd: Selection = { ...selection, right: Infinity };
        let register = command.register;
        switch (name) {
            case 'd': case 'x': case '<Del>':
                if (block) this.#blockDelete(selection, register); else this.#delete(region, register);
                break;
            case 'X': case 'D':
                if (block && name === 'D') this.#blockDelete(toEnd, register); else this.#delete(lines, register);
                break;
            case 'y':
                if (block) {
                    editor.registers.yank(register, { text: this.#blockText(selection), linewise: false, block: true });
                    let line = selection.start.line;
                    editor.cursor = { line, col: this.#blockCols(selection, line)[0] };
                } else {
                    this.#yank(region, register);
                }
                break;
            case 'Y': this.#yank(lines, register); break;
            case 'c': case 's':
                if (block) this.#blockInsert(selection, register, 'change'); else this.#change(region, register);
                return;
            case 'C': case 'S': case 'R':
                if (block && name === 'C') this.#blockInsert(toEnd, register, 'change');
                else this.#change(lines, register);
                return;
            case 'I': case 'A':
                if (block) {
                    this.#blockInsert(selection, register, name === 'I' ? 'before' : 'after');
                } else if (name === 'I') {
                    editor.startInsert(selection.kind === 'line'
                        ? { line: selection.start.line, col: firstNonBlank(editor.buffer.line(selection.start.line)) }
                        : selection.start);
                } else {
                    editor.startInsert(selection.kind === 'line'
                        ? { line: selection.end.line, col: editor.buffer.line(selection.end.line).length }
                        : editor.buffer.clamp(region.end));
                }
                return;
            case '>': case '<':
                for (let i = 0; i < count; i++) this.#shift(lines, name === '>');
                break;
            case '~': case 'u': case 'U': case 'g~': case 'gu': case 'gU': {
                let operator = name === 'u' || name === 'gu' ? 'gu' : name === 'U' || name === 'gU' ? 'gU' : '~';
                if (block) {
                    let change = (part: string) => (operator === 'gu' ? part.toLowerCase()
                        : operator === 'gU' ? part.toUpperCase() : toggleCase(part));
                    this.#blockEach(selection, change);
                } else {
                    this.#changeCase(region, operator);
                }
                break;
            }
            case 'J': case 'gJ':
                editor.cursor = { line: selection.start.line, col: 0 };
                this.#join(Math.max(2, selection.end.line - selection.start.line + 1), name === 'J');
                break;
            case 'r': {
                let char = command.arg!;
                if (!isCharKey(char)) break;
                if (block) {
                    this.#blockEach(selection, (part) => char.repeat(part.length));
                } else {
                    let start = region.linewise ? { line: region.start.line, col: 0 } : region.start;
                    let end = region.linewise
                        ? { line: region.end.line, col: editor.buffer.line(region.end.line).length } : region.end;
                    let text = editor.buffer.slice(start, end);
                    editor.buffer.delete(start, end, editor.cursor);
                    editor.buffer.insert(start, text.replace(/[^\n]/g, char));
                    editor.cursor = start;
                }
                break;
            }
            case 'p': case 'P': {
                let value = editor.registers.get(register ?? '"');
                if (value === undefined) {
                    editor.fail(`E353: Nothing in register ${register ?? '"'}`);
                    break;
                }
                // The selection is replaced (p keeps it in the unnamed register, P throws it away, as in vim).
                let lastLines = selection.end.line === editor.buffer.lineCount - 1 && selection.start.line > 0;
                let discard = name === 'P' ? '_' : undefined;
                if (block) this.#blockDelete(selection, discard); else this.#delete(region, discard);
                if (value.linewise && !region.linewise) {
                    let { line, col } = editor.cursor;
                    editor.buffer.insert({ line, col }, '\n' + value.text + '\n');
                    editor.gotoLine(line + 1);
                } else if (!value.linewise && region.linewise) {
                    editor.buffer.insert({ line: region.start.line, col: 0 }, value.text + '\n');
                    editor.cursor = { line: region.start.line, col: 0 };
                } else {
                    this.#putValue(value, count, region.linewise && lastLines);
                }
                break;
            }
            default:
        }
        if (editor.mode === 'normal') editor.cursor = editor.normalCol(editor.cursor);
    }

    #blockDelete(selection: Selection, register: string | undefined): void {
        let editor = this.#editor;
        editor.registers.delete(register, { text: this.#blockText(selection), linewise: false, block: true });
        this.#blockEach(selection, () => '');
        editor.wantHere();
    }

    /** I / A / c in a block: Insert mode on its first line; Esc puts what was typed into the other lines. */
    #blockInsert(selection: Selection, register: string | undefined, how: 'before' | 'after' | 'change'): void {
        let editor = this.#editor;
        let buffer = editor.buffer;
        let first = selection.start.line;
        if (how === 'change') this.#blockDelete(selection, register);
        let x = how === 'after' ? (selection.right === Infinity ? Infinity : selection.right + 1) : selection.left;
        let text = buffer.line(first);
        let width = displayCol(text, text.length);
        let col: number;
        if (x === Infinity) {
            col = text.length;
        } else if (width < x) {
            buffer.insert({ line: first, col: text.length }, ' '.repeat(x - width), editor.cursor);
            col = buffer.line(first).length;
        } else {
            col = colAtDisplay(text, x);
        }
        editor.startInsert({ line: first, col }, 'insert', 1, '', {
            first, last: selection.end.line, x, pad: how === 'after',
        });
    }
}

/** The keys that select, from the cursor, a selection as big as `selection` (so that '.' repeats on as much text). */
function selectionKeys(selection: Selection): string[] {
    let lines = selection.end.line - selection.start.line;
    let down = lines > 0 ? [...String(lines), 'j'] : [];
    switch (selection.kind) {
        case 'line':
            return ['V', ...down];
        case 'block': {
            let width = selection.right - selection.left;
            let across = selection.right === Infinity ? ['$'] : width > 0 ? [...String(width), 'l'] : [];
            return ['<C-v>', ...down, ...across];
        }
        default: {
            if (lines === 0) {
                let width = selection.end.col - selection.start.col;
                return ['v', ...(width > 0 ? [...String(width), 'l'] : [])];
            }
            let end = selection.end.col;
            return ['v', ...down, '0', ...(end > 0 ? [...String(end), 'l'] : [])];
        }
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
