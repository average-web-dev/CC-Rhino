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
import system from 'system';
import { TTY, CSI as TTY_CSI } from '/rom/lib/tty';

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

    constructor(id: number, tty: TTY, argv: string[], cwd: string) {
        this.id = id;
        this.tty = tty;
        this.argv = argv;
        this.cwd = cwd;
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
    return new Job(nextJob++, tty, argv, cwd);
}

/** Wait until `thread` ended. */
function join(thread: ThreadHandle): void {
    while (thread.isAlive()) system.yield();
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
    let savedFlowing = tty.stdin.readableFlowing;
    users[id] = (users[id] ?? 0) + 1;
    tty.setRawMode(false);
    tty.stdin.setFlowing(null);
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
        let code = exitCodeOf(error);
        if (error === undefined || code === null) return { code: job.exitCode ?? 0 };
        if (code !== undefined) return { code };
        // The program failed: report it on its TTY, on a row of its own (it may have stopped mid-line, at its prompt).
        if ((tty.cursorColumn() ?? 0) > 0) tty.stderr.write('\n');
        let message = (error as any)?.message === 'Terminated' ? 'Terminated' : formatError(resolved, error);
        tty.stderr.write(message + '\n');
        return { code: 1, error };
    } finally {
        tty.stdin.removeListenersOf(job.id);
        tty.setRawMode(savedRaw);
        tty.stdin.setFlowing(savedFlowing);
        users[id] -= 1;
        if (users[id] <= 0) {
            delete users[id];
            events.emit('tty_released', id);
        }
    }
}
