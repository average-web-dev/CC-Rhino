// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/motions.ts — where vi's motions and text objects go, computed on a TextBuffer.
//
// A motion moves from the cursor to a target; with an operator (d, c, y …) the text between them is changed. Its kind
// says which text that is, as in vim: 'exclusive' (up to the target), 'inclusive' (the target too) or 'linewise' (the
// whole lines). Words follow vim: a word is a run of letters, digits and '_', or a run of other non-blank characters;
// a WORD is any run of non-blank characters; an empty line counts as a word.

import { before, type Position, type TextBuffer } from '/rom/lib/internal/vi/buffer';
import { colAtDisplay } from '/rom/lib/internal/vi/tabs';

export type MotionKind = 'exclusive' | 'inclusive' | 'linewise';

export interface Target {
    pos: Position;
    kind: MotionKind;
    /** The screen column vertical moves aim for afterwards ('end': the end of each line, after '$'). */
    want?: number | 'end';
}

/** What a motion needs besides the buffer and the cursor. */
export interface MotionContext {
    buffer: TextBuffer;
    cursor: Position;
    /** The count (1 without one) and whether one was typed (G and % differ then). */
    count: number;
    counted: boolean;
    /** The character after f / t / F / T. */
    arg?: string;
    /** The column vertical motions aim for. */
    want: number | 'end';
    /** The first line shown and the number of rows (H, M, L). */
    top: number;
    rows: number;
    /** The last f / t / F / T, for ; and ,. */
    lastFind?: { motion: string; char: string };
}

/** A motion: its kind and where it goes (undefined: it fails, e.g. f without the character on the line). */
interface Motion {
    /** Whether the motion takes a character (f, t, F, T). */
    arg?: boolean;
    run(ctx: MotionContext): Target | undefined;
}

// ── Characters and words ────────────────────────────────────────────────────────────────────────────────────────────

/** The class of a character for word motions: 0 blank (or a line end), 1 word character, 2 other (punctuation). */
function charClass(ch: string, big: boolean): number {
    if (ch === '' || ch === '\n' || /\s/.test(ch)) return 0;
    if (big) return 1;
    return /\w/.test(ch) ? 1 : 2;
}

/** The character at `pos` ('\n' at the end of a line, '' past the end of the text). */
function charAt(buffer: TextBuffer, pos: Position): string {
    let line = buffer.line(pos.line);
    if (pos.col < line.length) return line.charAt(pos.col);
    return pos.line < buffer.lineCount - 1 ? '\n' : '';
}

/** The next position, crossing line ends (each line end is a position of its own), or undefined at the end. */
function next(buffer: TextBuffer, pos: Position): Position | undefined {
    if (pos.col < buffer.line(pos.line).length) return { line: pos.line, col: pos.col + 1 };
    return pos.line < buffer.lineCount - 1 ? { line: pos.line + 1, col: 0 } : undefined;
}

/** The previous position, or undefined at the start. */
function prev(buffer: TextBuffer, pos: Position): Position | undefined {
    if (pos.col > 0) return { line: pos.line, col: Math.min(pos.col, buffer.line(pos.line).length) - 1 };
    return pos.line > 0 ? { line: pos.line - 1, col: buffer.line(pos.line - 1).length } : undefined;
}

/** Whether `pos` is an empty line (which counts as a word). */
function emptyLine(buffer: TextBuffer, pos: Position): boolean {
    return pos.col === 0 && buffer.line(pos.line).length === 0;
}

function wordForward(buffer: TextBuffer, from: Position, big: boolean): Position {
    let pos: Position | undefined = from;
    let cls = charClass(charAt(buffer, pos), big);
    if (cls !== 0) {
        while (pos !== undefined && charClass(charAt(buffer, pos), big) === cls) pos = next(buffer, pos);
    }
    while (pos !== undefined && charClass(charAt(buffer, pos), big) === 0) {
        if (emptyLine(buffer, pos) && before(from, pos)) return pos;
        pos = next(buffer, pos);
    }
    // At the end of the text: its end.
    return pos ?? { line: buffer.lineCount - 1, col: buffer.line(buffer.lineCount - 1).length };
}

function wordBackward(buffer: TextBuffer, from: Position, big: boolean): Position {
    let pos = prev(buffer, from);
    while (pos !== undefined && charClass(charAt(buffer, pos), big) === 0) {
        if (emptyLine(buffer, pos)) return pos;
        pos = prev(buffer, pos);
    }
    if (pos === undefined) return { line: 0, col: 0 };
    let cls = charClass(charAt(buffer, pos), big);
    for (let p = prev(buffer, pos); p !== undefined && charClass(charAt(buffer, p), big) === cls; p = prev(buffer, p)) {
        pos = p;
    }
    return pos;
}

function wordEnd(buffer: TextBuffer, from: Position, big: boolean): Position {
    let pos = next(buffer, from);
    while (pos !== undefined && charClass(charAt(buffer, pos), big) === 0) pos = next(buffer, pos);
    if (pos === undefined) return from;
    let cls = charClass(charAt(buffer, pos), big);
    for (let p = next(buffer, pos); p !== undefined && charClass(charAt(buffer, p), big) === cls; p = next(buffer, p)) {
        pos = p;
    }
    return pos;
}

function wordEndBackward(buffer: TextBuffer, from: Position, big: boolean): Position {
    let pos: Position | undefined = from;
    let cls = charClass(charAt(buffer, pos), big);
    if (cls !== 0) {
        while (pos !== undefined && charClass(charAt(buffer, pos), big) === cls) pos = prev(buffer, pos);
    }
    while (pos !== undefined && charClass(charAt(buffer, pos), big) === 0) {
        if (emptyLine(buffer, pos) && before(pos, from)) return pos;
        pos = prev(buffer, pos);
    }
    return pos ?? { line: 0, col: 0 };
}

/** Repeat a position step `count` times. */
function repeat(ctx: MotionContext, step: (pos: Position) => Position): Position {
    let pos = ctx.cursor;
    for (let i = 0; i < ctx.count; i++) pos = step(pos);
    return pos;
}

/** The column of the first non-blank character of `text` (0 for an empty or blank line, as in vim). */
export function firstNonBlank(text: string): number {
    let match = /\S/.exec(text);
    return match === null ? Math.max(0, text.length - 1) : match.index;
}

function lineTarget(buffer: TextBuffer, line: number): Target {
    let target = Math.max(0, Math.min(line, buffer.lineCount - 1));
    return { pos: { line: target, col: firstNonBlank(buffer.line(target)) }, kind: 'linewise' };
}

// ── Find and brackets ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * f / t forwards, F / T backwards: to the `count`th `char` on the line (t / T stop next to it). Repeated with ; or ,
 * (`again`), t / T skip the character right next to the cursor, which they found last time.
 */
function find(ctx: MotionContext, motion: string, char: string, again = false): Target | undefined {
    let text = ctx.buffer.line(ctx.cursor.line);
    let forward = motion === 'f' || motion === 't';
    let skip = again && (motion === 't' || motion === 'T') ? 1 : 0;
    let col = ctx.cursor.col;
    for (let i = 0; i < ctx.count; i++) {
        let step = 1 + (i === 0 ? skip : 0);
        let from = forward ? col + step : col - step;
        let at = forward ? text.indexOf(char, from) : from < 0 ? -1 : text.lastIndexOf(char, from);
        if (at < 0) return undefined;
        col = at;
    }
    if (motion === 't') col -= 1;
    if (motion === 'T') col += 1;
    return { pos: { line: ctx.cursor.line, col }, kind: forward ? 'inclusive' : 'exclusive' };
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };

/** The bracket matching the one at `pos`, or undefined. */
export function matchBracket(buffer: TextBuffer, pos: Position): Position | undefined {
    let open = charAt(buffer, pos);
    let close = PAIRS[open];
    let forward = '([{'.indexOf(open) >= 0;
    let depth = 0;
    for (let p: Position | undefined = pos; p !== undefined; p = forward ? next(buffer, p) : prev(buffer, p)) {
        let ch = charAt(buffer, p);
        if (ch === open) depth++;
        else if (ch === close && --depth === 0) return p;
    }
    return undefined;
}

// ── The motions ─────────────────────────────────────────────────────────────────────────────────────────────────────

function vertical(ctx: MotionContext, delta: number): Target | undefined {
    let line = ctx.cursor.line + delta * ctx.count;
    if (line < 0 || line >= ctx.buffer.lineCount) {
        if (ctx.cursor.line === (delta < 0 ? 0 : ctx.buffer.lineCount - 1)) return undefined;
        line = Math.max(0, Math.min(line, ctx.buffer.lineCount - 1));
    }
    let text = ctx.buffer.line(line);
    let col = ctx.want === 'end' ? text.length : colAtDisplay(text, ctx.want);
    return { pos: { line, col }, kind: 'linewise', want: ctx.want };
}

function horizontal(ctx: MotionContext, delta: number): Target | undefined {
    let length = ctx.buffer.line(ctx.cursor.line).length;
    let col = Math.max(0, Math.min(ctx.cursor.col + delta * ctx.count, length));
    if (col === ctx.cursor.col) return undefined;
    return { pos: { line: ctx.cursor.line, col }, kind: 'exclusive' };
}

const MOTIONS: Record<string, Motion> = {
    h: { run: (ctx) => horizontal(ctx, -1) },
    l: { run: (ctx) => horizontal(ctx, 1) },
    j: { run: (ctx) => vertical(ctx, 1) },
    k: { run: (ctx) => vertical(ctx, -1) },
    '0': { run: (ctx) => ({ pos: { line: ctx.cursor.line, col: 0 }, kind: 'exclusive' }) },
    '^': {
        run: (ctx) => {
            let col = firstNonBlank(ctx.buffer.line(ctx.cursor.line));
            return { pos: { line: ctx.cursor.line, col }, kind: 'exclusive' };
        },
    },
    $: {
        run: (ctx) => {
            let line = Math.min(ctx.cursor.line + ctx.count - 1, ctx.buffer.lineCount - 1);
            let col = Math.max(0, ctx.buffer.line(line).length - 1);
            return { pos: { line, col }, kind: 'inclusive', want: 'end' };
        },
    },
    g_: {
        run: (ctx) => {
            let line = Math.min(ctx.cursor.line + ctx.count - 1, ctx.buffer.lineCount - 1);
            let text = ctx.buffer.line(line);
            return { pos: { line, col: Math.max(0, text.replace(/\s+$/, '').length - 1) }, kind: 'inclusive' };
        },
    },
    w: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordForward(ctx.buffer, p, false)), kind: 'exclusive' }) },
    W: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordForward(ctx.buffer, p, true)), kind: 'exclusive' }) },
    b: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordBackward(ctx.buffer, p, false)), kind: 'exclusive' }) },
    B: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordBackward(ctx.buffer, p, true)), kind: 'exclusive' }) },
    e: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordEnd(ctx.buffer, p, false)), kind: 'inclusive' }) },
    E: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordEnd(ctx.buffer, p, true)), kind: 'inclusive' }) },
    ge: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordEndBackward(ctx.buffer, p, false)), kind: 'inclusive' }) },
    gE: { run: (ctx) => ({ pos: repeat(ctx, (p) => wordEndBackward(ctx.buffer, p, true)), kind: 'inclusive' }) },
    gg: { run: (ctx) => lineTarget(ctx.buffer, ctx.counted ? ctx.count - 1 : 0) },
    G: { run: (ctx) => lineTarget(ctx.buffer, ctx.counted ? ctx.count - 1 : ctx.buffer.lineCount - 1) },
    '+': { run: (ctx) => lineTarget(ctx.buffer, ctx.cursor.line + ctx.count) },
    '-': { run: (ctx) => lineTarget(ctx.buffer, ctx.cursor.line - ctx.count) },
    H: { run: (ctx) => lineTarget(ctx.buffer, ctx.top + ctx.count - 1) },
    L: { run: (ctx) => lineTarget(ctx.buffer, Math.min(ctx.top + ctx.rows, ctx.buffer.lineCount) - ctx.count) },
    M: {
        run: (ctx) => {
            let shown = Math.min(ctx.rows, ctx.buffer.lineCount - ctx.top);
            return lineTarget(ctx.buffer, ctx.top + Math.floor((shown - 1) / 2));
        },
    },
    '}': {
        run: (ctx) => {
            let line = ctx.cursor.line;
            for (let i = 0; i < ctx.count; i++) {
                while (line < ctx.buffer.lineCount - 1 && ctx.buffer.line(line) === '') line++;
                while (line < ctx.buffer.lineCount - 1 && ctx.buffer.line(line) !== '') line++;
            }
            let col = ctx.buffer.line(line) === '' ? 0 : ctx.buffer.line(line).length;
            return { pos: { line, col }, kind: 'exclusive' };
        },
    },
    '{': {
        run: (ctx) => {
            let line = ctx.cursor.line;
            for (let i = 0; i < ctx.count; i++) {
                while (line > 0 && ctx.buffer.line(line) === '') line--;
                while (line > 0 && ctx.buffer.line(line) !== '') line--;
            }
            return { pos: { line, col: 0 }, kind: 'exclusive' };
        },
    },
    f: { arg: true, run: (ctx) => find(ctx, 'f', ctx.arg!) },
    F: { arg: true, run: (ctx) => find(ctx, 'F', ctx.arg!) },
    t: { arg: true, run: (ctx) => find(ctx, 't', ctx.arg!) },
    T: { arg: true, run: (ctx) => find(ctx, 'T', ctx.arg!) },
    ';': {
        run: (ctx) => (ctx.lastFind === undefined ? undefined : find(ctx, ctx.lastFind.motion, ctx.lastFind.char, true)),
    },
    ',': {
        run: (ctx) => {
            if (ctx.lastFind === undefined) return undefined;
            let reverse: Record<string, string> = { f: 'F', F: 'f', t: 'T', T: 't' };
            return find(ctx, reverse[ctx.lastFind.motion], ctx.lastFind.char, true);
        },
    },
    '%': {
        run: (ctx) => {
            if (ctx.counted) return lineTarget(ctx.buffer, Math.ceil(ctx.count * ctx.buffer.lineCount / 100) - 1);
            let text = ctx.buffer.line(ctx.cursor.line);
            for (let col = ctx.cursor.col; col < text.length; col++) {
                if (PAIRS[text.charAt(col)] === undefined) continue;
                let match = matchBracket(ctx.buffer, { line: ctx.cursor.line, col });
                return match === undefined ? undefined : { pos: match, kind: 'inclusive' };
            }
            return undefined;
        },
    },
};

/** Other names for motions: keys that do the same. */
const ALIASES: Record<string, string> = {
    '<Left>': 'h', '<BS>': 'h', '<Right>': 'l', ' ': 'l', '<Down>': 'j', '<C-n>': 'j', '<C-j>': 'j', '<Up>': 'k',
    '<C-p>': 'k', '<Home>': '0', '<End>': '$', '<CR>': '+', '<C-Left>': 'b', '<S-Left>': 'b', '<C-Right>': 'w',
    '<S-Right>': 'w',
};

/** The motion a key (or 'g' and a key) names, or undefined. */
export function motionName(key: string): string | undefined {
    let name = ALIASES[key] ?? key;
    return MOTIONS[name] === undefined ? undefined : name;
}

/** Whether motion `name` needs a character after it (f, t, F, T). */
export function motionTakesArg(name: string): boolean {
    return MOTIONS[name]?.arg === true;
}

/** Where motion `name` goes from the context's cursor, or undefined if it fails. */
export function runMotion(name: string, ctx: MotionContext): Target | undefined {
    return MOTIONS[name].run(ctx);
}

// ── Text objects ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A text object's text: from `start` to `end` (exclusive), whole lines if `linewise`. */
export interface Range {
    start: Position;
    end: Position;
    linewise: boolean;
}

const BRACKET_OBJECTS: Record<string, [string, string]> = {
    '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'], '[': ['[', ']'], ']': ['[', ']'],
    '{': ['{', '}'], '}': ['{', '}'], B: ['{', '}'], '<': ['<', '>'], '>': ['<', '>'],
};

/** Text object `i` / `a` + `kind` around `cursor` (iw, aw, i", a(, ip …), or undefined if there is none. */
export function textObject(buffer: TextBuffer, cursor: Position, around: boolean, kind: string): Range | undefined {
    let text = buffer.line(cursor.line);
    if (kind === 'w' || kind === 'W') {
        if (text.length === 0) return undefined;
        let big = kind === 'W';
        let cls = charClass(text.charAt(cursor.col), big);
        let start = cursor.col;
        let end = cursor.col + 1;
        while (start > 0 && charClass(text.charAt(start - 1), big) === cls) start--;
        while (end < text.length && charClass(text.charAt(end), big) === cls) end++;
        if (around) {
            if (end < text.length && /\s/.test(text.charAt(end))) {
                while (end < text.length && /\s/.test(text.charAt(end))) end++;
            } else {
                while (start > 0 && /\s/.test(text.charAt(start - 1))) start--;
            }
        }
        return { start: { line: cursor.line, col: start }, end: { line: cursor.line, col: end }, linewise: false };
    }
    if (kind === '"' || kind === "'" || kind === '`') {
        let open = text.lastIndexOf(kind, cursor.col - (text.charAt(cursor.col) === kind ? 1 : 0));
        let close: number;
        if (text.charAt(cursor.col) === kind && open < 0) {
            open = cursor.col;
            close = text.indexOf(kind, open + 1);
        } else {
            close = text.indexOf(kind, Math.max(cursor.col, open + 1));
        }
        if (open < 0 || close < 0) return undefined;
        let start = around ? open : open + 1;
        let end = around ? close + 1 : close;
        if (around) while (end < text.length && /\s/.test(text.charAt(end))) end++;
        return { start: { line: cursor.line, col: start }, end: { line: cursor.line, col: end }, linewise: false };
    }
    let brackets = BRACKET_OBJECTS[kind];
    if (brackets !== undefined) {
        let [open, close] = brackets;
        // The innermost open bracket around the cursor.
        let depth = 0;
        let at: Position | undefined = charAt(buffer, cursor) === close ? prev(buffer, cursor) : cursor;
        if (charAt(buffer, cursor) === open) at = cursor;
        let start: Position | undefined;
        for (; at !== undefined; at = prev(buffer, at)) {
            let ch = charAt(buffer, at);
            if (ch === close && !(at.line === cursor.line && at.col === cursor.col)) depth++;
            else if (ch === open) {
                if (depth === 0) { start = at; break; }
                depth--;
            }
        }
        if (start === undefined) return undefined;
        let end = matchBracketOf(buffer, start, open, close);
        if (end === undefined) return undefined;
        if (around) return { start, end: next(buffer, end) ?? end, linewise: false };
        return { start: next(buffer, start) ?? start, end, linewise: false };
    }
    if (kind === 'p') {
        let blank = (line: number) => buffer.line(line).trim() === '';
        let first = cursor.line;
        let last = cursor.line;
        let kindBlank = blank(cursor.line);
        while (first > 0 && blank(first - 1) === kindBlank) first--;
        while (last < buffer.lineCount - 1 && blank(last + 1) === kindBlank) last++;
        if (around) while (last < buffer.lineCount - 1 && blank(last + 1) !== kindBlank) last++;
        return { start: { line: first, col: 0 }, end: { line: last, col: 0 }, linewise: true };
    }
    return undefined;
}

function matchBracketOf(buffer: TextBuffer, start: Position, open: string, close: string): Position | undefined {
    let depth = 0;
    for (let p: Position | undefined = start; p !== undefined; p = next(buffer, p)) {
        let ch = charAt(buffer, p);
        if (ch === open) depth++;
        else if (ch === close && --depth === 0) return p;
    }
    return undefined;
}
