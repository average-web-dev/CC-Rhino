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
const canColor = term.isColor();

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
        }
    }

    function processLine(line: string): void {
        const parts = line.match(/\S+/g) ?? [];
        if (parts.length === 0) return;
        const cmd = parts[0] as string;
        const rawArgs = parts.slice(1)

        // Resolve args: flags (-x) and absolute paths keep as-is; the rest are CWD-relative.
        const args = rawArgs.map(a =>
            (a.startsWith('-') || a.startsWith('/')) ? a : resolvePath(a)
        );

        // ── Built-ins ────────────────────────────────────────────────────────
        if (cmd === 'cd') {
            const target = args[0] ?? '/';
            try {
                const stat = fs.statSync(target);
                if (stat.isDirectory) {
                    cwd = target === '/' ? '/' : target.replace(/\/+$/, '');
                } else {
                    print(`bash: cd: not a directory: ${rawArgs[0] ?? '/'}`);
                }
            } catch {
                print(`bash: cd: no such file or directory: ${rawArgs[0] ?? '/'}`);
            }
            return;
        }

        if (cmd === 'exit') {
            events.off('char', onChar);
            events.off('key',  onKey);
            term.setCursorBlink(false);
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
