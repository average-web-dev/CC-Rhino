// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `parallel` — green threads + structured concurrency, modelled on CC's parallel
// module. Backed by the pure-JS singleton at /rom/lib/parallel.ts.

/** Cooperative stop signal handed to a task; check `shouldStop` in your loop. */
interface ThreadSignal {
    /** Set to `true` by ThreadHandle.stop(); a task should notice this and exit. */
    shouldStop: boolean;
}

/** A unit of concurrent work. Run as its own green thread; its return value is ignored. */
type ParallelTask = (signal: ThreadSignal) => unknown;

/** Handle to a spawned green thread. */
interface ThreadHandle {
    /** Unique id of the thread. */
    readonly id: number;
    /** Request a cooperative stop — sets the task's `signal.shouldStop` to `true`. Non-blocking. */
    stop(): void;
}

interface ParallelModule {
    /**
     * Launch a task as a background green thread, returning a handle to stop it.
     * The task receives a {@link ThreadSignal}; check `signal.shouldStop` in long
     * loops so {@link ThreadHandle.stop} can end it gracefully.
     */
    spawn(task: ParallelTask): ThreadHandle;
    /**
     * Run all tasks until any one finishes. Returns the 0-based index of the
     * first task to finish (or -1 if none were given). Remaining tasks keep
     * running in the background.
     */
    waitForAny(...tasks: ParallelTask[]): number;
    /** Run all tasks until every one finishes. */
    waitForAll(...tasks: ParallelTask[]): void;
    /**
     * Run all tasks until at least `count` of them finish; returns how many have
     * finished.
     */
    waitForN(count: number, ...tasks: ParallelTask[]): number;
}
