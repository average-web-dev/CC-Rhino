// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/tty.ts — the computer's TTYs and the jobs (programs) running on them.
//
// TTYs: one TTY object (/rom/lib/tty) per native TTY, so the stream state of a TTY (flowing, listeners) is shared by
// everyone using it. The first console of the screen is the computer's TTY; this module takes over the screen.
//
// Jobs: a running program is a job — its TTY (process.stdin/stdout/stderr), argv, working directory and exit code. The
// job is the *context* of the thread running the program (internal/loop.setContext), so every thread, timer and
// listener the program creates belongs to it, and `process` (/rom/lib/process) always means the calling program's job.
// The bios, the OS layer and everything outside a program run as the root job (on the first console).
//
// run() runs a program as a job, like a child process: in a thread of its own, with a fresh stdin (cooked, not
// flowing). After main() (or the module's top-level code) returns, the job keeps running while it has ref'd pending
// work, as a Node process would (#46): a pending (ref'd) timer, a blocked callback or pending /promises operation, a
// child thread, or stdin it reads (each stdin listener holds a keep-alive handle while stdin flows). If main() returns
// a promise (`async main`, #44), its rejection is the program's error. When nothing is left, or on process.exit(), the
// job's thread is stopped: every events.on listener, unref'd timer, promise reaction or thread it left behind is
// discarded. Ctrl+C makes the call it is blocked in throw `Error("Terminated")`.

import events from 'events';
import loop from 'internal/loop';
import parallel from 'parallel';
import screen from 'screen';
import system from 'internal/system';
import { TTY, CSI as TTY_CSI } from '/rom/lib/tty';
import { Signal } from '/rom/lib/system';

export const CSI = TTY_CSI;

// ── Jobs ─────────────────────────────────────────────────────────────────────────

/** A running program: its TTY, arguments, working directory and exit code. */
export class Job {
    readonly id: number;
    readonly tty: TTY;
    argv: string[];
    cwd: string;
    /** process.exitCode. */
    exitCode: number | undefined = undefined;
    /** Set by process.exit(). */
    exiting = false;
    exitRequest = 0;
    /** Set when the promise returned by main() rejected. */
    failure: { error: unknown } | null = null;
    /** A shell: Ctrl+C while it waits for input does not end it (it reaches the programs it runs instead). */
    shell = false;
    /** process.on('exit') listeners, called with the exit code when the program has ended. */
    exitListeners: ((code: number) => void)[] = [];
    /** The pid of the program that started this one (process.ppid; 0: the root, i.e. the OS). */
    readonly ppid: number;
    /** When it was created, in milliseconds since the epoch (Date.now()). */
    readonly startTime = Date.now();

    constructor(id: number, tty: TTY, argv: string[], cwd: string, ppid = 0) {
        this.id = id;
        this.tty = tty;
        this.argv = argv;
        this.cwd = cwd;
        this.ppid = ppid;
    }
}

let nextJob = 1;

/** The job of the calling thread: the program it belongs to, or the root job. */
export function current(): Job {
    let context = loop.context();
    return context instanceof Job ? context : root;
}

// ── TTYs ─────────────────────────────────────────────────────────────────────────

const ttys: { [id: number]: TTY } = {};

/** The TTY object for a native TTY (one per native TTY, so everyone shares its stream state). */
export function ttyOf(handle: TtyHandle): TTY {
    let id = handle.getId();
    let tty = ttys[id];
    if (tty === undefined) tty = ttys[id] = TTY.from(handle, { owner: () => current().id });
    return tty;
}

/** A new virtual TTY whose stdin listeners belong to the program adding them (for child_process). */
export function createVirtual(columns?: number, rows?: number): TTY {
    let tty = new TTY(columns, rows, { owner: () => current().id });
    ttys[tty.handle.getId()] = tty;
    return tty;
}

/** A console of the screen, as a TTY. */
export function console(index: number): TTY {
    return ttyOf(screen.getConsole(index));
}

/** The computer's TTY: the first console of the screen, which this module shows from now on. */
export const terminal = console(0);
screen.activate();

/** The root job: the bios, the OS layer and everything not run as a program. */
export const root = new Job(0, terminal, ['bash'], '/');

/** The column of the cursor on the calling program's TTY (0 at the start of a line, or for a virtual TTY). */
export function cursorColumn(): number {
    return current().tty.cursorColumn() ?? 0;
}

/** How many jobs use each TTY (by native id). */
const users: { [id: number]: number } = {};

/** Whether a program is running on `tty` (the OS starts a shell on a console only while it is free). */
export function inUse(tty: TTY): boolean {
    return (users[tty.handle.getId()] ?? 0) > 0;
}

// ── Running programs ─────────────────────────────────────────────────────────────

const EXIT_SIGNAL = '__ccProcessExit';

/** The signal that ends a job: `code` null for a normal end (the job's code returned), else a process.exit code. */
function exitSignal(code: number | null): Error {
    let err = new Error(code === null ? 'job ended' : 'process.exit(' + code + ')');
    Object.defineProperty(err, EXIT_SIGNAL, { value: code });
    return err;
}

/**
 * If `e` is the signal that ends a job: the process.exit() code, or `null` for a normal end (use process.exitCode).
 * Otherwise undefined.
 */
export function exitCodeOf(e: unknown): number | null | undefined {
    if (e !== null && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, EXIT_SIGNAL)) {
        return (e as any)[EXIT_SIGNAL] as number | null;
    }
    return undefined;
}

/**
 * process.exit(): end the calling program with `code`, at once (as in Node): the program's thread fails with the end
 * signal, also when process.exit is called from a callback or another thread while the main code is blocked. Returns
 * the signal to throw, which unwinds the calling code.
 */
export function requestExit(code: number): Error {
    let job = current();
    job.exiting = true;
    job.exitRequest = code;
    let signal = exitSignal(code);
    loop.exitContext(signal);
    return signal;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
        && typeof (value as { then?: unknown }).then === 'function';
}

/** Block the job's thread while it has ref'd pending work, then end it (always throws, see the header). */
function waitForJob(job: Job, result?: unknown): never {
    if (isThenable(result)) {
        result.then(undefined, (error: unknown) => {
            if (job.failure === null) job.failure = { error };
            loop.wakeIdle();
        });
    }
    while (!job.exiting && job.failure === null) {
        try {
            if (loop.waitIdle()) break;
        } catch (e: any) {
            if (job.shell && e?.message === 'Terminated') continue;
            throw e;
        }
    }
    if (!job.exiting && job.failure !== null) throw job.failure.error;
    throw exitSignal(job.exiting ? job.exitRequest : null);
}

/**
 * Format a program's error as a single `file:line: message` line. The location is taken from the first stack frame
 * outside the module loader, as errors created with `new Error()` carry no fileName/lineNumber of their own.
 */
export function formatError(fallbackFile: string, e: any): string {
    let msg = e?.message ?? String(e);
    let frames = String(e?.stack ?? '').split('\n');
    for (let frame of frames) {
        let m = /^\s*at (.+?):(\d+)(?: \(.*\))?$/.exec(frame);
        if (m && m[1] !== 'require-setup.js') return `${m[1]}:${m[2]}: ${msg}`;
    }
    return `${fallbackFile}: ${msg}`;
}

/** How a job ended. */
export interface JobResult {
    /** The exit code (process.exit, process.exitCode; 1 if it failed). */
    code: number;
    /** The error the program failed with (including `Error("Terminated")` for Ctrl+C or kill()). */
    error?: unknown;
}

/** Create a job (not started yet). */
export function createJob(tty: TTY, argv: string[], cwd: string): Job {
    return new Job(nextJob++, tty, argv, cwd, current().id);
}

// ── The process table ────────────────────────────────────────────────────────────
// Every running program by pid (the root job, pid 0, included): system.processes(), process.kill(), ps and kill. A job
// is in it from its start until its end; the events process_start (info) and process_end (info, code) say when
// (system.on('processStart' | 'processEnd')).

const table = new Map<number, Job>([[0, root]]);

/**
 * Tell listeners that `job` started or ended. A listener that throws is reported on the job's TTY: it must not keep
 * the job from being run or cleaned up.
 */
function announce(job: Job, result?: JobResult): void {
    try {
        if (result === undefined) events.emit('process_start', infoOf(job));
        else events.emit('process_end', infoOf(job), result.code);
    } catch (error: unknown) {
        job.tty.stderr.write(formatError('<process event>', error) + '\n');
    }
}

/** A snapshot of `job` for programs (system.processes(), the process events). */
export function infoOf(job: Job): ProcessInfo {
    return Object.freeze({
        pid: job.id, ppid: job.ppid, argv: Object.freeze([...job.argv]), cwd: job.cwd, tty: job.tty.handle.getId(),
        startTime: job.startTime,
    });
}

/** The running programs, by pid. */
export function processes(): Job[] {
    return [...table.values()].sort((a, b) => a.id - b.id);
}

/** The running program with `pid`, or undefined. */
export function processOf(pid: number): Job | undefined {
    return table.get(pid);
}

/** `signal` (a Signal number or Node's name) as a signal's name, or undefined if it names none. */
export function signalName(signal: unknown): SignalName | undefined {
    for (let [name, number] of Object.entries(Signal)) {
        if (signal === name || signal === number) return name as SignalName;
    }
    return undefined;
}

const SIGNAL_MESSAGES: Record<SignalName, string> = { SIGINT: 'Interrupted', SIGKILL: 'Killed', SIGTERM: 'Terminated' };
const SIGNAL = '__ccSignal';

/** The signal `e` ends a program with (the error process.kill() fails it with), or undefined. */
export function signalOf(e: unknown): SignalName | undefined {
    if (e !== null && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, SIGNAL)) {
        return (e as any)[SIGNAL] as SignalName;
    }
    return undefined;
}

/**
 * Send `signal` to the program `job`: it ends at once, as with Ctrl+C, wherever it is blocked; its exit code is
 * 128 + the signal's number and the shell reports the signal ("Terminated", "Killed", "Interrupted"). Its
 * process.on('exit') listeners run, except for SIGKILL. Returns whether it was still running.
 */
export function kill(job: Job, signal: SignalName): boolean {
    let error = new Error(SIGNAL_MESSAGES[signal]);
    Object.defineProperty(error, SIGNAL, { value: signal });
    let killed = loop.failContext(job, error);
    // Killing the calling program itself: unwind the calling code too, as process.exit() does.
    if (killed && job === current()) throw error;
    return killed;
}

/** Wait until `thread` ended. */
function join(thread: ThreadHandle): void {
    while (thread.isAlive()) system.yield();
}

/**
 * Switch off the terminal modes a program may have asked for and not undone (it was stopped, ended with process.exit(),
 * or its cleanup never ran): mouse reports and bracketed paste go off and the alternate screen is left (showing the
 * shell's output, cursor and colours as before), so the shell is not left with them. Whoever wants them again asks
 * again (readline does when it resumes). Only on a TTY a device shows: on a virtual one the sequences would end up in
 * the captured output.
 */
function resetModes(tty: TTY): void {
    if (tty.cursorColumn() === undefined) return;
    tty.stdout.write(CSI.mouse(false) + CSI.bracketedPaste(false) + CSI.alternateScreen(false));
}

/** How a job ended, from the error its thread ended with (undefined: none). */
function resultOf(job: Job, error: unknown): JobResult {
    let signal = signalOf(error);
    if (signal !== undefined) return { code: 128 + Signal[signal], error };
    let code = exitCodeOf(error);
    if (error === undefined || code === null) return { code: job.exitCode ?? 0 };
    if (code !== undefined) return { code };
    return { code: 1, error };
}

/**
 * Call the job's process.on('exit') listeners with its exit code, as Node does when a process ends (normal end,
 * process.exit(), a failure, Ctrl+C), in a thread with the job as context (so `process` is still the program). They
 * may set process.exitCode or call process.exit(code) to change the code; a listener that throws fails the program.
 */
function emitExit(job: Job, id: number, result: JobResult): JobResult {
    let listeners = job.exitListeners;
    if (listeners.length === 0 || signalOf(result.error) === 'SIGKILL') return result;
    job.exitListeners = [];
    job.exiting = false;
    job.exitCode = result.code;
    let error: unknown = undefined;
    try {
        parallel.waitForAll(() => {
            loop.setContext(job, id);
            for (let listener of listeners) listener(result.code);
        });
    } catch (e: unknown) {
        error = e;
    }
    let after = resultOf(job, error);
    // The program's own failure (or the signal it was killed with) is the one worth reporting.
    if (result.error === undefined) return after;
    if (signalOf(result.error) !== undefined && after.error === undefined) return result;
    return { code: after.error !== undefined ? 1 : after.code, error: result.error };
}

/** How to run a program (see run()). */
export interface RunOptions {
    /**
     * Run in the background: the caller waits for the program in a thread of its own, and `onStart` receives the
     * program's thread (kill() stops it). Otherwise the program is part of the caller's foreground.
     */
    background?: boolean;
    onStart?: (thread: ThreadHandle) => void;
}

/**
 * Run the program at `resolved` (a path require.resolve returned) as `job`, blocking the calling thread until it ends.
 * The program runs in a new thread whose context is the job (so Ctrl+C on the job's TTY reaches it).
 */
export function run(job: Job, resolved: string, args: string[], options: RunOptions = {}): JobResult {
    let tty = job.tty;
    let id = tty.handle.getId();
    let savedRaw = tty.isRaw;
    let savedProtocol = tty.stdin.getKeyboardProtocol();
    let savedFlowing = tty.stdin.readableFlowing;
    users[id] = (users[id] ?? 0) + 1;
    tty.setRawMode(false);
    tty.stdin.setKeyboardProtocol('kitty');
    tty.stdin.setFlowing(null);
    let modesReset = false;
    table.set(job.id, job);
    announce(job);
    let ended: JobResult = { code: 1 };
    try {
        let body = () => {
            loop.setContext(job, id);
            let mod = require.uncached(resolved) as any;
            let result: unknown = typeof mod?.main === 'function' ? mod.main(args, job.cwd) : undefined;
            waitForJob(job, result);
        };
        let error: unknown = undefined;
        if (options.background) {
            let thread = parallel.spawn(body);
            if (options.onStart !== undefined) options.onStart(thread);
            join(thread);
            error = thread.getError();
        } else {
            try {
                parallel.waitForAll(body);
            } catch (e: unknown) {
                error = e;
            }
        }
        let result = ended = emitExit(job, id, resultOf(job, error));
        // Before an error is reported: on the alternate screen it would vanish with it.
        resetModes(tty);
        modesReset = true;
        if (result.error === undefined) return result;
        // The program failed: report it on its TTY, on a row of its own (it may have stopped mid-line, at its prompt).
        if ((tty.cursorColumn() ?? 0) > 0) tty.stderr.write('\n');
        let terminated = signalOf(result.error) !== undefined || (result.error as any)?.message === 'Terminated';
        let message = terminated ? (result.error as Error).message : formatError(resolved, result.error);
        tty.stderr.write(message + '\n');
        return result;
    } finally {
        // Programs this one ran (spawnSync, spawn) run in threads below its own: if it was killed, they died with it
        // before their own run() could clean up. They end here, children first, then this one.
        for (let orphan of descendantsOf(job).reverse()) {
            orphan.tty.stdin.removeListenersOf(orphan.id);
            endJob(orphan, ended);
        }
        tty.stdin.removeListenersOf(job.id);
        if (!modesReset) resetModes(tty);
        tty.stdin.setKeyboardProtocol(savedProtocol);
        tty.setRawMode(savedRaw);
        tty.stdin.setFlowing(savedFlowing);
        endJob(job, ended);
    }
}

/** The running programs `job` started, and theirs, … (parents before their children). */
function descendantsOf(job: Job): Job[] {
    let found: Job[] = [];
    let parents = new Set([job.id]);
    for (let other of processes()) {
        // Pids grow, so a parent is always seen before its children.
        if (other !== job && parents.has(other.ppid)) {
            found.push(other);
            parents.add(other.id);
        }
    }
    return found;
}

/** `job` has ended: out of the process table, announced, and its TTY released when nobody else uses it. */
function endJob(job: Job, result: JobResult): void {
    if (!table.delete(job.id)) return;
    announce(job, result);
    let id = job.tty.handle.getId();
    users[id] -= 1;
    if (users[id] <= 0) {
        delete users[id];
        events.emit('tty_released', id);
    }
}
