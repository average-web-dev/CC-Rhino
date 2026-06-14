// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/parallel.ts — green threads + structured concurrency, modelled on CC's
// `parallel`.
//
// spawn(task) launches a background green thread and returns a handle { id, stop }.
// Every task is handed a `signal`; calling handle.stop() sets signal.shouldStop so
// a cooperative task can break out of its loop and clean up. stop() is non-blocking
// — it only requests the stop; the thread ends whenever it next checks the flag.
//
// Each task runs via events.setImmediate(), so it may sleep(), arm timers, or
// register events.on() callbacks and they all interleave on the event loop. The
// waitFor* coordinators block cooperatively with system.yield() (≈ one tick) until
// the requested number of tasks finish; a task error propagates to the caller.
//
// Difference from CC: tasks run on the global event loop rather than a private
// scheduler, so waitForAny's "losers" keep running rather than freezing (JS cannot
// suspend a foreign continuation) — drive long tasks off signal.shouldStop instead.

const events = require('events');
const system = require('system');

interface Thread {
    id: number;
    signal: ThreadSignal;
    done: boolean;
    error: unknown;
    failed: boolean;
}

let nextId = 1;

/** Start a task as a green thread and return its bookkeeping record. */
function launch(task: ParallelTask): Thread {
    const thread: Thread = {
        id: nextId++,
        signal: { shouldStop: false },
        done: false,
        error: undefined,
        failed: false,
    };
    events.setImmediate(() => {
        try {
            task(thread.signal);
        } catch (e) {
            thread.error = e;
            thread.failed = true;
        } finally {
            thread.done = true;
        }
    });
    return thread;
}

/** Spawn a background green thread; returns a handle to stop it cooperatively. */
function spawn(task: ParallelTask): ThreadHandle {
    const thread = launch(task);
    return {
        id: thread.id,
        stop(): void { thread.signal.shouldStop = true; },
    };
}

/** Throw the first thread's error, if any has failed. */
function rethrowFirstError(threads: Thread[]): void {
    for (const t of threads) if (t.failed) throw t.error;
}

function countDone(threads: Thread[]): number {
    let n = 0;
    for (const t of threads) if (t.done) n++;
    return n;
}

/**
 * Run all tasks until at least `count` of them have finished; returns how many
 * have finished. Blocks the caller cooperatively (one check per tick).
 */
function waitForN(count: number, ...tasks: ParallelTask[]): number {
    const target = Math.min(count, tasks.length);
    const threads = tasks.map(launch);
    while (true) {
        rethrowFirstError(threads);
        const done = countDone(threads);
        if (done >= target) return done;
        system.yield();
    }
}

/**
 * Run all tasks until any one finishes; returns the 0-based index of the first
 * to finish (or -1 if no tasks were given).
 */
function waitForAny(...tasks: ParallelTask[]): number {
    if (tasks.length === 0) return -1;
    const threads = tasks.map(launch);
    while (true) {
        rethrowFirstError(threads);
        for (let i = 0; i < threads.length; i++) if ((threads[i] as Thread).done) return i;
        system.yield();
    }
}

/** Run all tasks until every one finishes. */
function waitForAll(...tasks: ParallelTask[]): void {
    const threads = tasks.map(launch);
    while (true) {
        rethrowFirstError(threads);
        if (countDone(threads) >= threads.length) return;
        system.yield();
    }
}

export = { spawn, waitForAny, waitForAll, waitForN };
