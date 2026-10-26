// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `parallel` — green threads with structured concurrency, modelled on CC's
// parallel API. Native module implemented by the engine (JSParallel / EventLoop).
//
// Every task runs as its own green thread. Anything a thread starts — events.on
// listeners, queueMicrotask/setImmediate callbacks, blocked calls, child threads —
// belongs to it: when a thread is stopped (or fails) all of that is discarded and
// never runs again. When a thread simply returns, whatever it leaves behind is
// inherited by its parent thread.
//
// Ctrl+T (the `terminate` event) is delivered to the foreground: every thread that
// is being waited for by a waitFor* call (directly or through its ancestors) and is
// blocked in sleep/yield/an I/O call has that call throw `Error("Terminated")`.
// Spawned background threads are not terminated.

/** A unit of concurrent work, run as its own green thread. Its return value is ignored. */
type ParallelTask = () => unknown;

/** Handle to a thread started with {@link ParallelModule.spawn}. */
interface ThreadHandle {
    /** Unique id of the thread. */
    readonly id: number;
    /**
     * Stop the thread immediately: wherever it is blocked it never resumes, and its
     * listeners, pending callbacks and child threads are discarded. No-op once it has
     * finished. Stopping the calling thread itself takes effect at its next blocking call.
     */
    stop(): void;
    /** Whether the thread is still running (has neither returned, failed nor been stopped). */
    isAlive(): boolean;
    /** The uncaught error the thread failed with, or `undefined`. */
    getError(): unknown;
}

interface ParallelModule {
    /**
     * Start a task as a background thread owned by the calling thread and return a
     * handle to it. The task starts once the caller blocks or returns. An uncaught
     * error ends the thread (see {@link ThreadHandle.getError}). Background threads
     * are not terminated by Ctrl+T, but are stopped when their owner is stopped.
     */
    spawn(task: ParallelTask): ThreadHandle;
    /**
     * Run all tasks until any one returns, then stop the others. Returns the 0-based
     * index of the first task to return (or -1 if none were given). If a task throws
     * first, the others are stopped and the error is rethrown here.
     */
    waitForAny(...tasks: ParallelTask[]): number;
    /**
     * Run all tasks until every one returns. If a task throws, the others are stopped
     * and the error is rethrown here.
     */
    waitForAll(...tasks: ParallelTask[]): void;
    /**
     * Run all tasks until `count` of them return (at most all of them), then stop the
     * rest. Returns how many returned. If a task throws first, the others are stopped
     * and the error is rethrown here.
     */
    waitForN(count: number, ...tasks: ParallelTask[]): number;
}

/**
 * `parallel/promises` — the same functions without blocking the caller: `waitFor*` start their threads once the
 * caller yields and return a promise that settles as the blocking call would return or throw. The threads belong to
 * the calling thread, and are stopped with it.
 */
interface ParallelPromisesModule {
    spawn(task: ParallelTask): Promise<ThreadHandle>;
    waitForAny(...tasks: ParallelTask[]): Promise<number>;
    waitForAll(...tasks: ParallelTask[]): Promise<void>;
    waitForN(count: number, ...tasks: ParallelTask[]): Promise<number>;
}
