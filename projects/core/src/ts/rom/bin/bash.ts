// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/bash.ts — interactive shell
//
// Exports:
//   run(path, ...args)  — run a program as a foreground job: load its module and call its main(args, cwd).
//   start()             — start the interactive prompt (a readline interface on process.stdin/stdout) and return;
//                         the shell lives on in its listeners.
//   getCwd()            — current working directory (process.cwd()).
//   setCwd(p)           — set the working directory (process.chdir()).

import readline from 'readline';
import * as tty from '/rom/lib/internal/tty';

import events   from 'events';
import fs       from 'fs';
import env      from 'env';
import parallel from 'parallel';
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

/**
 * Format an error as a single `file:line: message` line. The location is taken from the first stack frame outside
 * the module loader, as errors created with `new Error()` carry no fileName/lineNumber of their own.
 */
function formatError(fallbackFile: string, e: any): string {
    let msg = e?.message ?? String(e);
    let frames = String(e?.stack ?? '').split('\n');
    for (let frame of frames) {
        let m = /^\s*at (.+?):(\d+)(?: \(.*\))?$/.exec(frame);
        if (m && m[1] !== 'require-setup.js') return `${m[1]}:${m[2]}: ${msg}`;
    }
    return `${fallbackFile}: ${msg}`;
}

/** Exit code of the last program (0 unless it failed or called process.exit). */
let lastExitCode = 0;

/**
 * Load a program and call its `main(args, cwd)` if present.
 * Bare names ('ls') are resolved via require.paths (JSRequire searches them).
 * Paths starting with '/', './', '../' are resolved against cwd.
 * Programs are loaded with `require.uncached`, so their top-level code runs on every invocation and edits take
 * effect immediately. Returns false only if the program itself was not found; errors raised by the program
 * (including a missing dependency) are printed and still count as found.
 *
 * The program runs as a foreground job, like a child process: its own green thread (waited for with
 * parallel.waitForAll), its own stdin state (see internal/tty), `process.argv` = ['bash', path, ...args], and the
 * working directory is restored afterwards. After main() (or the module's top-level code) returns, the job keeps
 * running while it has ref'd pending work, as a Node process would (#46): a pending (ref'd) timer, a blocked callback
 * or pending /promises operation, a child thread, or stdin it reads (a readline interface or stdin listener left
 * open). If main() returns a promise (`async main`, #44), its rejection is the program's error. When nothing is left,
 * or on process.exit(), the job's thread is stopped: every events.on listener, unref'd timer, promise reaction or
 * thread it left behind is discarded, so nothing it started runs (or prints) after the prompt. Ctrl+T makes the call
 * it is blocked in — usually that wait — throw `Error("Terminated")`; we then print "Terminated".
 */
export function run(path: string, ...args: string[]): boolean {
    return runProgram(path, args);
}

function runProgram(path: string, args: string[]): boolean {
    let isPath = path.startsWith('/') || path.startsWith('./') || path.startsWith('../');
    let toRequire = isPath ? resolvePath(path) : path;
    let resolved: string;
    try {
        resolved = require.resolve(toRequire);
    } catch {
        return false;
    }

    let savedArgv = process.argv;
    let savedCwd = process.cwd();
    let cwd = savedCwd;
    process.argv = ['bash', '/' + resolved.replace(/^\/+/, '')].concat(args);
    process.exitCode = undefined;
    lastExitCode = 0;
    let job = tty.beginJob();
    try {
        parallel.waitForAll(() => {
            let mod = require.uncached(resolved) as any;
            let result: unknown = typeof mod?.main === 'function' ? mod.main(args, cwd) : undefined;
            tty.waitForJob(job, result);
        });
    } catch (e: any) {
        let exitCode = tty.exitCodeOf(e);
        if (exitCode === null) {
            lastExitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
        } else if (exitCode !== undefined) {
            lastExitCode = exitCode;
        } else {
            lastExitCode = 1;
            // Report on a row of its own, even if the program was interrupted mid-line (e.g. at its prompt).
            if (tty.cursorColumn() > 0) process.stdout.write('\n');
            if (e?.message === 'Terminated') console.error('Terminated');
            else console.error(formatError(resolved, e));
        }
    } finally {
        tty.endJob(job);
        process.argv = savedArgv;
        process.exitCode = undefined;
        try { process.chdir(savedCwd); } catch { /* the directory was removed meanwhile */ }
    }
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

function processLine(line: string, rl: Interface): void {
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
        rl.close();
        process.stdout.write(tty.CSI.hideCursor);
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
    rl.pause();
    let found = runProgram(cmd, args);
    if (!found) {
        console.error((cmd as string).includes('/')
            ? `bash: ${cmd}: No such file or directory`
            : `bash: ${cmd}: command not found`);
    }
}

/** Exit code of the last program run with run(). */
export function getExitCode(): number { return lastExitCode; }

