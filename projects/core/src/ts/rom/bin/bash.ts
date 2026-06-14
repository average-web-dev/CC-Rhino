// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/bash.ts — interactive shell
//
// Exports:
//   run(path, ...args)  — load a program module and call its main(args, cwd).
//   start()             — enter the event-driven REPL loop (blocks via listeners).
//   getCwd()            — current working directory (used by programs that need it).
//   setCwd(p)           — set cwd externally (e.g. from a parent shell wrapper).

const events   = require('events');
const term     = require('term');
const fs       = require('fs');
const env      = require('env');
const canColor = term.isColor();

// Names that may follow `$` / `${...}` during variable expansion.
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
// A leading `NAME=` assignment token.
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Expand `$NAME` / `${NAME}` against the environment; unknown vars become "". */
function expandVars(text: string): string {
    return text.replace(VAR_RE, (_m, braced, bare) => env.get(braced ?? bare) ?? '');
}

// ── State ──────────────────────────────────────────────────────────────────────

let cwd = '/';

// ── Path helpers ───────────────────────────────────────────────────────────────
function resolvePath(p: string): string {
    if (p.startsWith('/')) return p;
    const raw = cwd.replace(/\/$/, '') + '/' + p;
    const out: string[] = [];
    for (let seg of raw.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { out.pop(); } else { out.push(seg); }
    }
    return '/' + out.join('/');
}

// ── Public API ─────────────────────────────────────────────────────────────────

function getCwd(): string  { return cwd; }
function setCwd(p: string) { cwd = p;    }

/**
 * Load a program and call its `main(args, cwd)` if present.
 * Bare names ('ls') are resolved via require.paths (JSRequire searches them).
 * Paths starting with '/', './', '../' are resolved against cwd.
 * Returns true on success, false if the module was not found or threw.
 */
function run(path: string, ...args: string[]): boolean {
    const isPath = path.startsWith('/') || path.startsWith('./') || path.startsWith('../');
    const toRequire = isPath ? resolvePath(path) : path;
    try {
        const mod = require(toRequire) as any;
        if (typeof mod?.main === 'function') {
            mod.main(args, cwd);
        }
        return true;
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!msg.includes('MODULE_NOT_FOUND')) {
            print(`${path}: ${msg}`);

    print(e.filename);
    print(e.lineNumber);
        }
        return false;
    }
}

// ── Tab completion ───────────────────────────────────────────────────────────

const BUILTINS = ['cd', 'exit', 'export', 'unset', 'env'];

interface Completion {
    word: string;     // full replacement for the token being completed
    display: string;  // label shown when several matches are listed
    isDir: boolean;   // directories complete with a trailing '/', everything else ' '
}

/** Longest common prefix shared by every string. */
function commonPrefix(items: string[]): string {
    if (items.length === 0) return '';
    let prefix = items[0] as string;
    for (let s of items) {
        let i = 0;
        while (i < prefix.length && prefix[i] === s[i]) i++;
        prefix = prefix.slice(0, i);
        if (prefix === '') break;
    }
    return prefix;
}

/** Complete a command name from the builtins and the programs on require.paths. */
function completeCommand(prefix: string): Completion[] {
    const names: Record<string, true> = {};
    for (let b of BUILTINS) names[b] = true;
    for (let dir of require.paths) {
        let entries: string[];
        try { entries = fs.readdirSync(dir) as string[]; } catch { continue; }
        for (let e of entries) names[e.endsWith('.js') ? e.slice(0, -3) : e] = true;
    }
    const out: Completion[] = [];
    for (let name of Object.keys(names)) {
        if (name.startsWith(prefix)) out.push({ word: name, display: name, isDir: false });
    }
    return out.sort((a, b) => (a.word < b.word ? -1 : 1));
}

/** Complete a filesystem path (relative to cwd) for the token being typed. */
function completePath(word: string): Completion[] {
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const basePart = slash >= 0 ? word.slice(slash + 1) : word;
    let entries: string[];
    try { entries = fs.readdirSync(resolvePath(dirPart === '' ? '.' : dirPart)) as string[]; }
    catch { return []; }
    const out: Completion[] = [];
    for (let e of entries) {
        if (!e.startsWith(basePart)) continue;
        let isDir = false;
        try { isDir = fs.statSync(resolvePath(dirPart + e)).isDirectory; } catch { /* unreadable */ }
        out.push({ word: dirPart + e, display: isDir ? e + '/' : e, isDir });
    }
    return out.sort((a, b) => (a.word < b.word ? -1 : 1));
}

/**
 * Enter the interactive REPL loop.
 * Registers `char` + `key` event listeners and shows a prompt.
 * The loop is fully event-driven — start() itself returns immediately;
 * the shell stays "alive" as long as the listeners are registered.
 */
function start(): void {
    let buffer = '';
    let cursor = 0;             // edit position within `buffer` (0..buffer.length)

    // Where the editable input begins on screen, captured each time the prompt is
    // drawn. Editing assumes the line does not wrap (matching the rest of the shell).
    let inputStartX = 0;
    let inputY = 0;

    // Command history. `history` holds past lines (oldest first); `historyIndex`
    // is the cursor into it while browsing — history.length means "the current,
    // not-yet-submitted line", whose in-progress text is stashed in `savedBuffer`.
    const history: string[] = [];
    let historyIndex = 0;
    let savedBuffer = '';

    function showPrompt(): void {
        if (canColor) term.setTextColor(32);   // lime — directory
        term.write(cwd + ' ');
        if (canColor) term.setTextColor(256);  // lightGrey — sigil
        term.write('$ ');
        if (canColor) term.setTextColor(1);    // white — user input
        const pos = term.getCursorPos();
        inputStartX = pos.x;
        inputY = pos.y;
        term.setCursorBlink(true);             // blinking underscore at the edit position
    }

    /** Redraw `buffer` from the input origin and park the terminal cursor at `cursor`. */
    function render(): void {
        term.setCursorPos({ x: inputStartX, y: inputY });
        term.write(buffer + ' ');   // trailing space erases the cell freed by a deletion
        term.setCursorPos({ x: inputStartX + cursor, y: inputY });
    }

    /** Replace the whole input line on screen (and in `buffer`) with `next`. */
    function replaceLine(next: string): void {
        const { y } = term.getCursorPos();
        term.setCursorPos({ x: 0, y });
        term.clearLine();
        showPrompt();
        buffer = next;
        cursor = next.length;
        term.write(buffer);
    }

    /** Replace the token under the cursor (text since the last space) with `text`. */
    function replaceWord(wordStart: number, text: string): void {
        buffer = buffer.slice(0, wordStart) + text + buffer.slice(cursor);
        cursor = wordStart + text.length;
        render();
    }

    /** Print the candidate labels below the input, then redraw the prompt + buffer. */
    function listMatches(labels: string[]): void {
        print('');
        print(labels.join('  '));
        showPrompt();
        term.write(buffer);
        term.setCursorPos({ x: inputStartX + cursor, y: inputY });
    }

    /** Tab — complete the command (first word) or a path argument under the cursor. */
    function handleTab(): void {
        const before = buffer.slice(0, cursor);
        const wordStart = before.lastIndexOf(' ') + 1;
        const word = before.slice(wordStart);
        const atCommand = before.slice(0, wordStart).trim() === '';

        const matches = atCommand && !word.includes('/')
            ? completeCommand(word)
            : completePath(word);
        if (matches.length === 0) return;

        if (matches.length === 1) {
            const m = matches[0] as Completion;
            replaceWord(wordStart, m.word + (m.isDir ? '/' : ' '));
            return;
        }

        // Several matches: extend to their common prefix, or list them if we are
        // already at it (the classic "first Tab completes, second Tab lists").
        const prefix = commonPrefix(matches.map(m => m.word));
        if (prefix.length > word.length) replaceWord(wordStart, prefix);
        else listMatches(matches.map(m => m.display));
    }

    function onChar(ch: string): void {
        if (cursor === buffer.length) {
            // Fast path: appending at the end, just echo the character.
            buffer += ch;
            cursor++;
            term.write(ch);
        } else {
            // Insert mid-line and redraw the shifted tail.
            buffer = buffer.slice(0, cursor) + ch + buffer.slice(cursor);
            cursor++;
            render();
        }
    }

    function onKey(key: number, held: boolean): void {
        if (held) return;
        switch (key) {
            case 257: case 335: {   // Enter / numpad Enter
                print('');          // move to next line
                const line = buffer.trim();
                buffer = '';
                cursor = 0;
                if (line) {
                    // Record in history, collapsing consecutive duplicates.
                    if (history[history.length - 1] !== line) history.push(line);
                    term.setCursorBlink(false);   // hide the cursor while the command runs
                    processLine(line);
                }
                historyIndex = history.length;
                savedBuffer = '';
                showPrompt();
                break;
            }
            case 265: {             // Up — recall older history entry
                if (historyIndex > 0) {
                    if (historyIndex === history.length) savedBuffer = buffer;
                    historyIndex--;
                    replaceLine(history[historyIndex] as string);
                }
                break;
            }
            case 264: {             // Down — recall newer entry / restore the in-progress line
                if (historyIndex < history.length) {
                    historyIndex++;
                    replaceLine(historyIndex === history.length ? savedBuffer : history[historyIndex] as string);
                }
                break;
            }
            case 263: {             // Left — move the cursor toward the start of the line
                if (cursor > 0) {
                    cursor--;
                    term.setCursorPos({ x: inputStartX + cursor, y: inputY });
                }
                break;
            }
            case 262: {             // Right — move the cursor toward the end of the line
                if (cursor < buffer.length) {
                    cursor++;
                    term.setCursorPos({ x: inputStartX + cursor, y: inputY });
                }
                break;
            }
            case 259: {             // Backspace — delete the char before the cursor
                if (cursor > 0) {
                    buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
                    cursor--;
                    render();
                }
                break;
            }
            case 258: {             // Tab — autocomplete the command or path
                handleTab();
                break;
            }
        }
    }

    function processLine(line: string): void {
        // Expand $VAR / ${VAR} first, then split into words. Programs receive these
        // words verbatim — each program resolves its own paths against cwd.
        const parts = expandVars(line).match(/\S+/g) ?? [];
        if (parts.length === 0) return;
        const cmd = parts[0] as string;
        const args = parts.slice(1);

        // ── Variable assignment (`NAME=value`) ───────────────────────────────
        const assign = ASSIGN_RE.exec(cmd);
        if (assign) {
            env.set(assign[1] as string, assign[2] as string);
            return;
        }

        // ── Built-ins ────────────────────────────────────────────────────────
        if (cmd === 'cd') {
            const raw = args[0];
            const target = raw ? resolvePath(raw) : '/';
            try {
                const stat = fs.statSync(target);
                if (stat.isDirectory) {
                    cwd = target === '/' ? '/' : target.replace(/\/+$/, '');
                } else {
                    print(`bash: cd: not a directory: ${raw ?? '/'}`);
                }
            } catch {
                print(`bash: cd: no such file or directory: ${raw ?? '/'}`);
            }
            return;
        }

        if (cmd === 'exit') {
            events.off('char', onChar);
            events.off('key',  onKey);
            term.setCursorBlink(false);
            return;
        }

        if (cmd === 'export') {
            for (let a of args) {
                let m = ASSIGN_RE.exec(a);
                if (m) env.set(m[1] as string, m[2] as string);
                else if (!env.has(a)) env.set(a, '');   // `export NAME` declares an empty var
            }
            return;
        }

        if (cmd === 'unset') {
            for (let a of args) env.unset(a);
            return;
        }

        if (cmd === 'env') {
            const all = env.all();
            for (let name of Object.keys(all).sort()) print(`${name}=${all[name]}`);
            return;
        }

        // ── External program ─────────────────────────────────────────────────
        const found = (run as (...a: string[]) => boolean).apply(null, [cmd].concat(args));
        if (!found && !(cmd as string).includes('/')) {
            // Only print "not found" for bare command names, not for explicit paths.
            print(`bash: ${cmd}: command not found`);
        }
    }

    events.on('char', onChar);
    events.on('key',  onKey);
    showPrompt();
}

export = {
    getCwd,
    setCwd,
    run,
    start,
}
