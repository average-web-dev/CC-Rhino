// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/tty.ts — the computer's TTY behind process.stdin/stdout/stderr, plus job control for the shell.
//
// The computer's TTY is the first console of its screen (`require('screen')`), which this module takes over; the
// streams are the `tty` module's ReadStream / WriteStream (see /rom/lib/tty for how they work). The output is rendered
// by the console's terminal emulator (VT-style: wrapping, scrolling, ANSI colours and cursor sequences; stderr in red).
// Typed input passes the TTY's line discipline (cooked by default, raw with setRawMode). The cursor is shown while
// stdin flows. While stdin is paused, input stays in the TTY (type ahead) until someone reads.
//
// Job control: the shell runs each program as a job. beginJob() gives the program a fresh stdin (not flowing, cooked);
// waitForJob() keeps the program running while it has ref'd pending work, like a Node process (#46): a pending timer,
// a blocked call or /promises operation, a child thread, or stdin it reads (each stdin listener holds a keep-alive
// handle while stdin flows); then it ends the job's thread so nothing the program left behind runs after it.
// endJob() closes the job's stdin listeners and restores the shell's terminal state.

import loop from 'internal/loop';
import screen from 'screen';
import { TTY, CSI as TTY_CSI } from '/rom/lib/tty';

// ── The TTY ──────────────────────────────────────────────────────────────────────

/** The cursor blinks while someone reads the terminal. */
let cursorShown = false;

function showCursor(show: boolean): void {
    if (show === cursorShown) return;
    cursorShown = show;
    terminal.stdout.write(show ? TTY_CSI.showCursor : TTY_CSI.hideCursor);
}

/** The id of the running job, or 0 outside of jobs. */
let currentJob = 0;

/** The computer's TTY: the first console of the screen, which this module shows from now on. */
export const terminal = TTY.from(screen.getConsole(0), { owner: () => currentJob, onFlowing: showCursor });
screen.activate();

export const stdin = terminal.stdin;
export const stdout = terminal.stdout;
export const stderr = terminal.stderr;
export const CSI = TTY_CSI;

/** The column of the cursor on the screen (0 at the start of a line). */
export function cursorColumn(): number {
    return terminal.cursorColumn() ?? 0;
}

// ── Job control (used by the shell) ─────────────────────────────────────────────

const EXIT_SIGNAL = '__ccProcessExit';

interface Job {
    id: number;
    parent: number;
    savedRaw: boolean;
    savedFlowing: boolean | null;
    exiting: boolean;
    exitCode: number;
    /** Set when the promise returned by main() rejected. */
    failure: { error: unknown } | null;
}

let nextJob = 1;
let jobs: Job[] = [];

function findJob(id: number): Job | undefined {
    for (let job of jobs) if (job.id === id) return job;
    return undefined;
}

/**
 * Start a job (a program run by the shell): it gets a fresh stdin — cooked, and not flowing until it reads — and the
 * cursor is hidden until it reads input. The shell's terminal state is restored by endJob().
 */
export function beginJob(): Job {
    let job: Job = {
        id: nextJob++, parent: currentJob,
        savedRaw: terminal.isRaw, savedFlowing: stdin.readableFlowing,
        exiting: false, exitCode: 0, failure: null,
    };
    jobs.push(job);
    currentJob = job.id;
    terminal.setRawMode(false);
    stdin.setFlowing(null);
    return job;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
        && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Called by the job's thread once its main code has returned (`result` is what main() returned): block while the
 * thread has ref'd pending work, like a Node process (see the header), then end the job by throwing a signal that
 * stops the job's thread — its leftover listeners, unref'd timers and promise reactions never run.
 *
 * - If main() returned a promise (an `async main`), its rejection is the program's error (exit code 1).
 * - process.exit() (also from a callback, or caught) ends the wait at once with its exit code.
 * - Ctrl+T reaches the wait like any blocking call: it throws "Terminated".
 *
 * Always throws: the job-end signal (exitCodeOf() gives `null` for a normal end, or the process.exit code), or the
 * error of a rejected main() promise.
 */
export function waitForJob(job: Job, result?: unknown): never {
    if (isThenable(result)) {
        result.then(undefined, (error: unknown) => {
            if (job.failure === null) job.failure = { error };
            loop.wakeIdle();
        });
    }
    while (!job.exiting && job.failure === null) {
        if (loop.waitIdle()) break;
    }
    if (!job.exiting && job.failure !== null) throw job.failure.error;
    throw exitSignal(job.exiting ? job.exitCode : null);
}

/** End a job: close the stdin listeners it left behind and restore the terminal state saved by beginJob(). */
export function endJob(job: Job): void {
    stdin.removeListenersOf(job.id);
    let index = jobs.indexOf(job);
    if (index >= 0) jobs.splice(index, 1);
    currentJob = job.parent;
    terminal.setRawMode(job.savedRaw);
    stdin.setFlowing(job.savedFlowing);
}

/** The id of the running job, or 0 outside of jobs. */
export function jobId(): number { return currentJob; }

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
 * process.exit(): end the running job with `code`. Returns the signal to throw, which unwinds the job's code; the
 * job also ends if the signal is caught (or thrown in a callback or another thread), as waitForJob() checks the flag.
 */
export function requestExit(code: number): Error {
    let job = findJob(currentJob);
    if (job !== undefined) {
        job.exiting = true;
        job.exitCode = code;
        loop.wakeIdle();
    }
    return exitSignal(code);
}
