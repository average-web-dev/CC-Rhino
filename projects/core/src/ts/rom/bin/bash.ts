// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/bash.ts — interactive shell
//
// As a program: `bash` starts the interactive prompt on its TTY (the OS runs one per console); `bash -c "<line>"`
// runs one command line and exits with its status (child_process.exec uses it).
//
// Exports:
//   main(args)          — see above.
//   run(path, ...args)  — run a program in the foreground (child_process.spawnSync on the shell's TTY).
//   start()             — start the interactive prompt (a readline interface on process.stdin/stdout) and return;
//                         the shell lives on in its listeners.
//   getCwd()            — current working directory (process.cwd()).
//   setCwd(p)           — set the working directory (process.chdir()).

import readline from 'readline';
import * as tty from '/rom/lib/internal/tty';
import { spawnSync } from '/rom/lib/child_process';

import events   from 'events';
import fs       from 'fs';
import env      from 'env';
import util     from 'util';

// Names that may follow `$` / `${...}` during variable expansion.
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
// A leading `NAME=` assignment token.
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Expand `$NAME` / `${NAME}` against the environment; unknown vars become "". */
function expandVars(text: string): string {
    return text.replace(VAR_RE, (_m, braced, bare) => env.get(braced ?? bare) ?? '');
}

// ── Path helpers ───────────────────────────────────────────────────────────────
function resolvePath(p: string): string {
    if (p.startsWith('/')) return p;
    let raw = process.cwd().replace(/\/$/, '') + '/' + p;
    let out: string[] = [];
    for (let seg of raw.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { out.pop(); } else { out.push(seg); }
    }
    return '/' + out.join('/');
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getCwd(): string  { return process.cwd(); }
export function setCwd(p: string) { process.chdir(p); }

const formatError = tty.formatError;

/** Exit code of the last program (0 unless it failed or called process.exit). */
let lastExitCode = 0;

/** `bash`: the interactive shell on this program's TTY; `bash -c "<line>"`: run one command line and exit. */
export function main(args: string[]): void {
    if (args[0] === '-c') {
        processLine(args.slice(1).join(' '), null);
        process.exitCode = lastExitCode;
        return;
    }
    // A shell outlives Ctrl+T at its prompt; the keys reach the programs it runs instead.
    tty.current().shell = true;
    start();
}

/**
 * Run a program in the foreground, on the shell's TTY (child_process.spawnSync). Bare names ('ls') are resolved via
 * require.paths, paths ('/', './', '../') against the working directory. Programs are loaded with `require.uncached`,
 * so their top-level code runs on every invocation and edits take effect immediately. The program runs as a job of its
 * own (see /rom/lib/internal/tty): its own thread, `process.argv` = ['bash', path, ...args], a working directory of
 * its own (it starts in the shell's), a fresh stdin. It keeps running while it has ref'd pending work, as a Node
 * process would (#46); when it ends, everything it left behind is discarded. A program that fails is reported on the
 * TTY (Ctrl+T: "Terminated"). Returns false only if the program itself was not found.
 */
export function run(path: string, ...args: string[]): boolean {
    let result = spawnSync(path, args, { stdio: 'inherit' });
    if (result.error !== undefined) return false;
    lastExitCode = result.status ?? 1;
    return true;
}

// ── Tab completion ───────────────────────────────────────────────────────────

const BUILTINS = ['cd', 'exit', 'export', 'unset', 'env'];

/** Command names: the builtins and the programs on require.paths. */
function completeCommand(prefix: string): string[] {
    let names: Record<string, true> = {};
    for (let b of BUILTINS) names[b] = true;
    for (let dir of require.paths) {
        let entries: string[];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        for (let e of entries) names[e.endsWith('.js') ? e.slice(0, -3) : e] = true;
    }
    let out: string[] = [];
    for (let name of Object.keys(names)) if (name.startsWith(prefix)) out.push(name);
    return out.sort();
}

/**
 * readline completer: complete the command (first word) or a path argument. Candidates are names within the
 * directory being completed (directories with a trailing '/'); a single command or file match gets a trailing space.
 */
function completer(line: string): [string[], string] {
    let wordStart = line.lastIndexOf(' ') + 1;
    let word = line.slice(wordStart);
    let atCommand = line.slice(0, wordStart).trim() === '';

    if (atCommand && !word.includes('/')) {
        let names = completeCommand(word);
        return [names.length === 1 ? [names[0] + ' '] : names, word];
    }

    let slash = word.lastIndexOf('/');
    let dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    let basePart = slash >= 0 ? word.slice(slash + 1) : word;
    let entries: FsDirent[];
    try { entries = fs.readdirSync(resolvePath(dirPart === '' ? '.' : dirPart), { withFileTypes: true }); }
    catch { return [[], basePart]; }
    let names: string[] = [];
    let onlyFile = false;
    for (let entry of entries) {
        if (!entry.name.startsWith(basePart)) continue;
        let isDir = entry.isDirectory();
        names.push(isDir ? entry.name + '/' : entry.name);
        onlyFile = !isDir;
    }
    names.sort();
    if (names.length === 1 && onlyFile) names[0] += ' ';
    return [names, basePart];
}

// ── REPL ───────────────────────────────────────────────────────────────────────

/** The prompt: cwd in lime, `$` in light grey (ANSI styles; ignored on monochrome terminals). */
function makePrompt(): string {
    return util.styleText('greenBright', process.cwd()) + ' ' + util.styleText('white', '$') + ' ';
}

/**
 * Start the interactive shell: a readline interface on process.stdin/stdout with history, line editing and tab
 * completion. Returns immediately; the shell is driven by the interface's listeners. Ctrl+C clears the line, Ctrl+D
 * on an empty line or `exit` closes the shell.
 */
export function start(): void {
    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer,
        historySize: 100,
        prompt: makePrompt(),
    });

    function prompt(): void {
        // Start the prompt on a fresh row if a program left the cursor mid-line.
        if (tty.cursorColumn() > 0) process.stdout.write('\n');
        rl.setPrompt(makePrompt());
        rl.prompt();
    }

    rl.on('line', (input: string) => {
        try {
            processLine(input.trim(), rl);
        } catch (e) {
            console.error(formatError('/rom/bin/bash.js', e));
        }
        if (!rl.closed) prompt();
    });

    rl.on('SIGINT', () => {
        // Like bash: show ^C, drop the line and start a new prompt.
        rl.write(null, { ctrl: true, name: 'e' });
        process.stdout.write('^C');
        rl.clearLine();
        rl.historyIndex = -1;
        prompt();
    });

    // A promise rejected without a handler fails the program that created it (and is printed like any program error,
    // see run()). Rejections nobody owns anymore — the program already returned, or shell-level code — arrive here.
    let onRejection = (error: Error) => console.error(formatError('<promise>', error));
    events.on('unhandled_rejection', onRejection);
    rl.on('close', () => { events.off('unhandled_rejection', onRejection); });

    prompt();
}

function processLine(line: string, rl: Interface | null): void {
    // Expand $VAR / ${VAR} first, then split into words. Programs receive these
    // words verbatim — each program resolves its own paths against cwd.
    let parts = expandVars(line).match(/\S+/g) ?? [];
    if (parts.length === 0) return;
    let cmd = parts[0] as string;
    let args = parts.slice(1);

    // ── Variable assignment (`NAME=value`) ───────────────────────────────
    let assign = ASSIGN_RE.exec(cmd);
    if (assign) {
        env.set(assign[1] as string, assign[2] as string);
        return;
    }

    // ── Built-ins ────────────────────────────────────────────────────────
    if (cmd === 'cd') {
        let raw = args[0];
        try {
            process.chdir(raw ? resolvePath(raw) : '/');
        } catch (e: any) {
            console.error(e?.code === 'ENOTDIR'
                ? `bash: cd: not a directory: ${raw ?? '/'}`
                : `bash: cd: no such file or directory: ${raw ?? '/'}`);
        }
        return;
    }

    if (cmd === 'exit') {
        if (rl !== null) {
            rl.close();
            process.stdout.write(tty.CSI.hideCursor);
        }
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
        let all = env.all();
        for (let name of Object.keys(all).sort()) console.log(`${name}=${all[name]}`);
        return;
    }

    // ── External program ─────────────────────────────────────────────────
    // Pause our interface while the program runs: the program owns the terminal (and gets a fresh stdin, see run()),
    // and we must not react to the same keys. Interactive programs block in main() or keep reading stdin; only when
    // the job has ended does the prompt come back.
    if (rl !== null) rl.pause();
    let found = run(cmd, ...args);
    if (!found) {
        console.error((cmd as string).includes('/')
            ? `bash: ${cmd}: No such file or directory`
            : `bash: ${cmd}: command not found`);
    }
}

/** Exit code of the last program run with run(). */
export function getExitCode(): number { return lastExitCode; }

