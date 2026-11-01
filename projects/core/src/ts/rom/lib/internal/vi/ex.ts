// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/ex.ts — the commands typed after ':' in vi, as in vim (names may be shortened: :w for :write).
//
//   :w [file]  :q  :q!  :wq  :x        write, quit (refused with unsaved changes, unless !), both
//   :e[!] [file]                       edit another file (or the same one again, ! dropping the changes)
//   :[range]s/pat/rep/[gi]             substitute (& the match, \1 … \9 its groups, \r a line break); :s again
//   :[range]d [x]  :[range]y [x]       delete / yank the lines (into register x)
//   :[range]> :[range]<  :[range]j     shift, join
//   :[range]m {line}  :[range]t {line} move / copy the lines below a line (0: to the top)
//   :set opt  :set noopt  :set opt=n   options (number, relativenumber, ignorecase, smartcase, hlsearch, wrapscan,
//                                      shiftwidth); :set opt? shows one, :set opt! toggles it
//   :noh                               stop highlighting the last search
//   :[range]                           go to the range's last line
//
// A range is one or two addresses (n, ., $, '<, '>, each with +n / -n) or %; without one most commands work on the
// cursor's line, :s and the others on that line too.

import type { Editor } from '/rom/lib/internal/vi/editor';
import { compile, matchesOn } from '/rom/lib/internal/vi/search';
import { firstNonBlank } from '/rom/lib/internal/vi/motions';

/** Lines `first` to `last` (from 0, both included). */
interface Range {
    first: number;
    last: number;
}

/** Ex command names with the shortest form vim accepts. */
const NAMES: [string, number][] = [
    ['write', 1], ['quit', 1], ['wq', 2], ['xit', 1], ['exit', 3], ['edit', 1], ['substitute', 1], ['delete', 1],
    ['yank', 1], ['join', 1], ['move', 1], ['copy', 2], ['t', 1], ['set', 2], ['nohlsearch', 3],
];

function commandName(name: string): string | undefined {
    for (let [full, shortest] of NAMES) {
        if (name.length >= shortest && full.startsWith(name)) return full;
    }
    return undefined;
}

class ExError extends Error {}

const NO_WRITE = 'E37: No write since last change (add ! to override)';

/** Run the command line `line` (without the ':'). */
export function execute(editor: Editor, line: string): void {
    try {
        run(editor, line.trim());
    } catch (e) {
        if (!(e instanceof ExError)) throw e;
        editor.fail(e.message);
    }
}

function run(editor: Editor, text: string): void {
    if (text === '') return;
    let [range, rest] = parseRange(editor, text);
    if (rest === '') {
        if (range !== undefined) editor.gotoLine(range.last);
        return;
    }
    if (rest.startsWith('>') || rest.startsWith('<')) {
        let shift = /^([<>]+)$/.exec(rest);
        if (shift === null) throw new ExError(`E492: Not an editor command: ${text}`);
        let lines = range ?? here(editor);
        editor.shiftLines(lines.first, lines.last, rest.charAt(0) === '>', shift[1].length);
        return;
    }
    if (rest === '&' || rest === '&&') {
        // :& repeats the last :s, :&& with its flags.
        substitute(editor, range ?? here(editor), rest.slice(1));
        return;
    }
    let match = /^([a-zA-Z]+)(!?)\s*([\s\S]*)$/.exec(rest);
    if (match === null) throw new ExError(`E492: Not an editor command: ${text}`);
    // The name is the letters at the start, so :s/a/b/ is :s with the argument /a/b/.
    let [, word, bang, argument] = match;
    let name = commandName(word);
    if (name === undefined) throw new ExError(`E492: Not an editor command: ${text}`);
    let force = bang === '!';
    let file = argument === '' ? undefined : argument;
    let lines = range ?? here(editor);
    switch (name) {
        case 'write':
            editor.write(file ?? editor.path);
            return;
        case 'quit':
            if (!force && editor.buffer.modified) throw new ExError(NO_WRITE);
            editor.quit = true;
            return;
        case 'wq': case 'xit': case 'exit':
            let write = name === 'wq' || editor.buffer.modified || file !== undefined;
            if (write && !editor.write(file ?? editor.path)) return;
            editor.quit = true;
            return;
        case 'edit':
            if (!force && editor.buffer.modified) throw new ExError(NO_WRITE);
            if (file === undefined && editor.path === undefined) throw new ExError('E32: No file name');
            editor.open(file ?? editor.path!);
            return;
        case 'substitute':
            substitute(editor, lines, argument);
            return;
        case 'delete': case 'yank': {
            let register = argument === '' ? undefined : argument.charAt(0);
            if (name === 'delete') editor.deleteLines(lines.first, lines.last, register);
            else editor.yankLines(lines.first, lines.last, register);
            return;
        }
        case 'join':
            editor.joinLines(lines.first, Math.max(lines.last, lines.first + 1), !force);
            return;
        case 'move': case 'copy': case 't': {
            let target = parseAddress(editor, argument.trim(), 0);
            if (target === undefined || target.rest !== '') throw new ExError('E14: Invalid address');
            let after = target.line;
            if (name === 'move' && after >= lines.first && after < lines.last) {
                throw new ExError('E134: Cannot move a range of lines into itself');
            }
            editor.copyLines(lines.first, lines.last, after, name === 'move');
            return;
        }
        case 'set':
            setOptions(editor, argument);
            return;
        case 'nohlsearch':
            editor.highlight = false;
            return;
        default:
    }
}

/** The cursor's line as a range. */
function here(editor: Editor): Range {
    return { first: editor.cursor.line, last: editor.cursor.line };
}

/**
 * One address at text[i] (n, ., $, '<, '>, with +n / -n after it; just +n / -n counts from the cursor's line), as a
 * line from 0 (-1: before the first line, for :m 0 / :t 0), and the text after it; undefined if there is none.
 */
function parseAddress(editor: Editor, text: string, i: number): { line: number; rest: string } | undefined {
    let line: number | undefined;
    let match: RegExpExecArray | null;
    let start = i;
    if (text.charAt(i) === '.') { line = editor.cursor.line; i++; }
    else if (text.charAt(i) === '$') { line = editor.buffer.lineCount - 1; i++; }
    else if ((match = /^\d+/.exec(text.slice(i))) !== null) {
        line = parseInt(match[0], 10) - 1;
        i += match[0].length;
    }
    else if (text.charAt(i) === "'" && (text.charAt(i + 1) === '<' || text.charAt(i + 1) === '>')) {
        let visual = editor.lastVisual;
        if (visual === undefined) throw new ExError('E20: Mark not set');
        let lines = [visual.anchor.line, visual.cursor.line].sort((a, b) => a - b);
        line = text.charAt(i + 1) === '<' ? lines[0] : lines[1];
        i += 2;
    }
    while ((match = /^\s*([+-])(\d*)/.exec(text.slice(i))) !== null && match[0].trim() !== '') {
        let offset = match[2] === '' ? 1 : parseInt(match[2], 10);
        line = (line ?? editor.cursor.line) + (match[1] === '+' ? offset : -offset);
        i += match[0].length;
    }
    if (line === undefined || i === start) return undefined;
    return { line, rest: text.slice(i) };
}

/** The range at the start of a command line (undefined: none given) and the command after it. */
function parseRange(editor: Editor, text: string): [Range | undefined, string] {
    let last = editor.buffer.lineCount - 1;
    if (text.startsWith('%')) return [{ first: 0, last }, text.slice(1).replace(/^\s+/, '')];
    let first = parseAddress(editor, text, 0);
    if (first === undefined) return [undefined, text];
    let range: Range = { first: first.line, last: first.line };
    let rest = first.rest;
    if (rest.startsWith(',') || rest.startsWith(';')) {
        let second = parseAddress(editor, rest, 1);
        if (second === undefined) throw new ExError('E14: Invalid address');
        range.last = second.line;
        rest = second.rest;
    }
    if (range.first > range.last) range = { first: range.last, last: range.first };
    if (range.first < 0 || range.last > last) throw new ExError('E16: Invalid range');
    return [range, rest.replace(/^\s+/, '')];
}

/**
 * :s/pattern/replacement/flags on the lines of `range` (any non-letter separates; an empty pattern is the last
 * search; no pattern at all repeats the last substitution).
 */
function substitute(editor: Editor, range: Range, spec: string): void {
    let pattern: string;
    let replacement: string;
    let flags: string;
    if (spec.trim() === '' || /^[&gciI]*$/.test(spec.trim())) {
        let last = editor.lastSubstitute;
        if (last === undefined) throw new ExError('E35: No previous regular expression');
        ({ pattern, replacement } = last);
        flags = spec.trim().replace(/&/g, last.flags);
    } else {
        let separator = spec.charAt(0);
        let parts = splitUnescaped(spec.slice(1), separator);
        pattern = parts[0] ?? '';
        replacement = parts[1] ?? '';
        flags = parts[2] ?? '';
        if (pattern === '') {
            if (editor.lastSearch === undefined) throw new ExError('E35: No previous regular expression');
            pattern = editor.lastSearch.pattern;
        }
    }
    editor.lastSubstitute = { pattern, replacement, flags };
    editor.lastSearch = { pattern, forward: true };
    let options = { ...editor.options };
    if (flags.indexOf('i') >= 0) options.ignorecase = true;
    if (flags.indexOf('I') >= 0) options.ignorecase = false;
    if (flags.indexOf('I') >= 0 || flags.indexOf('i') >= 0) options.smartcase = false;
    let regex = compile(pattern, options);
    if (typeof regex === 'string') throw new ExError(regex);
    let global = flags.indexOf('g') >= 0;

    let buffer = editor.buffer;
    let count = 0;
    let changedLines = 0;
    let lastChanged = -1;
    // From the last line up, so that line breaks put in (\r) do not move the lines still to do.
    for (let line = range.last; line >= range.first; line--) {
        let text = buffer.line(line);
        let matches = matchesOn(regex, text);
        if (matches.length === 0) continue;
        if (!global) matches = matches.slice(0, 1);
        let out = '';
        let at = 0;
        for (let [start, end] of matches) {
            regex.lastIndex = start;
            let groups = regex.exec(text)!;
            out += text.slice(at, start) + expandReplacement(replacement, groups);
            at = end;
        }
        out += text.slice(at);
        buffer.delete({ line, col: 0 }, { line, col: text.length }, editor.cursor);
        buffer.insert({ line, col: 0 }, out);
        count += matches.length;
        changedLines++;
        if (lastChanged < 0) lastChanged = line + out.split('\n').length - 1;
    }
    if (count === 0) throw new ExError(`E486: Pattern not found: ${pattern}`);
    editor.cursor = { line: lastChanged, col: firstNonBlank(buffer.line(lastChanged)) };
    editor.wantHere();
    if (count > 2 || changedLines > 1) {
        let plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
        editor.message = `${plural(count, 'substitution')} on ${plural(changedLines, 'line')}`;
    }
}

/** Split `text` at `separator`s not escaped with a backslash (the escape stays, unless it escaped the separator). */
function splitUnescaped(text: string, separator: string): string[] {
    let parts: string[] = [''];
    for (let i = 0; i < text.length; i++) {
        let ch = text.charAt(i);
        if (ch === '\\' && i + 1 < text.length) {
            let next = text.charAt(i + 1);
            parts[parts.length - 1] += next === separator ? next : ch + next;
            i++;
        } else if (ch === separator) {
            parts.push('');
        } else {
            parts[parts.length - 1] += ch;
        }
    }
    return parts;
}

/** A replacement with vim's specials: & (the match), \0 – \9 (groups), \r / \n (a line break), \& \\ (themselves). */
function expandReplacement(replacement: string, groups: RegExpExecArray): string {
    let out = '';
    for (let i = 0; i < replacement.length; i++) {
        let ch = replacement.charAt(i);
        if (ch === '&') { out += groups[0]; continue; }
        if (ch !== '\\' || i + 1 >= replacement.length) { out += ch; continue; }
        let next = replacement.charAt(++i);
        if (/[0-9]/.test(next)) out += groups[Number(next)] ?? '';
        else if (next === 'r' || next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else out += next;
    }
    return out;
}

/** :set: options on (opt), off (noopt), toggled (opt!), shown (opt?) or given a value (opt=n). */
function setOptions(editor: Editor, argument: string): void {
    let shown: string[] = [];
    for (let item of argument.split(/\s+/).filter((s) => s !== '')) {
        let match = /^(no)?([a-z]+)([!?]|[=:]\d+)?$/.exec(item);
        let name = match === null ? undefined : OPTION_NAMES[match[2]];
        if (match === null || name === undefined) throw new ExError(`E518: Unknown option: ${item}`);
        let value = editor.options[name];
        let suffix = match[3];
        if (typeof value === 'number') {
            if (suffix === undefined || suffix === '?') { shown.push(`${name}=${value}`); continue; }
            if (suffix === '!' || match[1] !== undefined) throw new ExError(`E474: Invalid argument: ${item}`);
            (editor.options as any)[name] = Math.max(1, parseInt(suffix.slice(1), 10));
            continue;
        }
        if (suffix === '?') { shown.push(value ? name : `no${name}`); continue; }
        if (suffix !== undefined && suffix !== '!') throw new ExError(`E474: Invalid argument: ${item}`);
        (editor.options as any)[name] = suffix === '!' ? !value : match[1] === undefined;
        if (name === 'hlsearch') editor.highlight = true;
    }
    if (argument.trim() === '') {
        let o = editor.options;
        for (let [key, value] of Object.entries(o)) {
            shown.push(typeof value === 'number' ? `${key}=${value}` : value ? key : `no${key}`);
        }
    }
    if (shown.length > 0) editor.message = shown.join('  ');
}

/** Option names and their short forms, to the option. */
const OPTION_NAMES: Record<string, keyof Editor['options']> = {
    number: 'number', nu: 'number', relativenumber: 'relativenumber', rnu: 'relativenumber',
    ignorecase: 'ignorecase', ic: 'ignorecase', smartcase: 'smartcase', scs: 'smartcase', hlsearch: 'hlsearch',
    hls: 'hlsearch', wrapscan: 'wrapscan', ws: 'wrapscan', shiftwidth: 'shiftwidth', sw: 'shiftwidth',
};
