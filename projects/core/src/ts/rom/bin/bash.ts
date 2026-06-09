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

    function showPrompt(): void {
        if (canColor) term.setTextColor(32);   // lime — directory
        term.write(cwd + ' ');
        if (canColor) term.setTextColor(256);  // lightGrey — sigil
        term.write('$ ');
        if (canColor) term.setTextColor(1);    // white — user input
    }

    function onChar(ch: string): void {
        buffer += ch;
        term.write(ch);
    }

    function onKey(key: number, held: boolean): void {
        if (held) return;
        switch (key) {
            case 257: case 335: {   // Enter / numpad Enter
                print('');          // move to next line
                const line = buffer.trim();
                buffer = '';
                if (line) processLine(line);
                showPrompt();
                break;
            }
            case 259: {             // Backspace
                if (buffer.length > 0) {
                    buffer = buffer.slice(0, -1);
                    const { x, y } = term.getCursorPos();
                    if (x > 0) {
                        term.setCursorPos({ x: x - 1, y });
                        term.write(' ');
                        term.setCursorPos({ x: x - 1, y });
                    }
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
