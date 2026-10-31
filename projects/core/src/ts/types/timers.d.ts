// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Node's timers (ROM modules /rom/lib/timers and /rom/lib/timers/promises, #45). The functions are globals, and also
// `require("timers")` (the same functions).
//
// Timers run on game ticks: delays in milliseconds are rounded up to whole ticks (1 tick = 50 ms), with a minimum of
// one tick, so `setTimeout(cb, 0)` runs on the next tick at the earliest. A callback runs in the thread that created
// the timer, may block, and is discarded when that thread is stopped. A ref'd pending timer (the default) keeps a
// shell job (the program) alive; `unref()` releases it.

/** A pending `setTimeout`/`setInterval` timer (Node's `Timeout`). */
interface Timeout {
    /** Keep the program alive while this timer is pending (the default). */
    ref(): this;
    /** Do not keep the program alive for this timer: if nothing else is pending, the program ends without it. */
    unref(): this;
    hasRef(): boolean;
    /** Restart the countdown from now with the same delay (also re-arms a timeout that has already fired). */
    refresh(): this;
    /** Cancel the timer, like `clearTimeout(timeout)`. */
    close(): this;
    /** The timer's numeric id, so `clearTimeout(Number(timeout))` works too. */
    [Symbol.toPrimitive](): number;
}

/** A pending `setImmediate` callback (Node's `Immediate`). */
interface Immediate {
    /** No effect: a pending immediate always runs (on the next tick) before the program ends. */
    ref(): this;
    /** Only changes `hasRef()`: a pending immediate always runs (on the next tick) before the program ends. */
    unref(): this;
    hasRef(): boolean;
}

/** Options of the `timers/promises` functions. `signal` (AbortSignal) is not supported. */
interface TimerOptions {
    /** Whether the timer keeps the program alive (default `true`). */
    ref?: boolean;
}

/**
 * Call `callback(...args)` once after `ms` milliseconds (rounded up to whole ticks, at least one). `this` is the
 * returned `Timeout`.
 */
declare function setTimeout<TArgs extends any[]>(callback: (...args: TArgs) => void, ms?: number, ...args: TArgs): Timeout;
declare function setTimeout(callback: (args: void) => void, ms?: number): Timeout;
/** Cancel a timeout; also takes its numeric id. Anything else (including `undefined`) is ignored. */
declare function clearTimeout(timeout: Timeout | string | number | undefined | null): void;
/** Call `callback(...args)` every `ms` milliseconds (rounded up to whole ticks, at least one) until cleared. */
declare function setInterval<TArgs extends any[]>(callback: (...args: TArgs) => void, ms?: number, ...args: TArgs): Timeout;
declare function setInterval(callback: (args: void) => void, ms?: number): Timeout;
/** Cancel an interval (the same as `clearTimeout`). */
declare function clearInterval(interval: Timeout | string | number | undefined | null): void;
/** Call `callback(...args)` on the next tick of the event loop, after the current events have been handled. */
declare function setImmediate<TArgs extends any[]>(callback: (...args: TArgs) => void, ...args: TArgs): Immediate;
declare function setImmediate(callback: (args: void) => void): Immediate;
declare function clearImmediate(immediate: Immediate | undefined | null): void;
/** Run `callback` as a microtask: after the current code, before anything else (like a promise reaction). */
declare function queueMicrotask(callback: () => void): void;

interface TimersModule {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    setImmediate: typeof setImmediate;
    clearImmediate: typeof clearImmediate;
    /** The same as `require("timers/promises")`. */
    readonly promises: TimersPromisesModule;
}

interface TimersPromisesModule {
    /** A promise fulfilled with `value` after `delay` milliseconds (rounded up to whole ticks). */
    setTimeout<T = void>(delay?: number, value?: T, options?: TimerOptions): Promise<T>;
    /** A promise fulfilled with `value` on the next tick. */
    setImmediate<T = void>(value?: T, options?: TimerOptions): Promise<T>;
    /**
     * An async iterator yielding `value` every `delay` milliseconds: `for await (const v of setInterval(1000)) {…}`.
     * Leaving the loop clears the interval.
     */
    setInterval<T = void>(delay?: number, value?: T, options?: TimerOptions): AsyncIterableIterator<T>;
    scheduler: {
        /** The same as `setTimeout(delay, undefined, options)`. */
        wait(delay: number, options?: TimerOptions): Promise<void>;
        /** The same as `setImmediate()`. */
        yield(): Promise<void>;
    };
}

declare function require(id: "timers"): TimersModule;
declare function require(id: "node:timers"): TimersModule;
declare function require(id: "timers/promises"): TimersPromisesModule;
declare function require(id: "node:timers/promises"): TimersPromisesModule;
declare module "timers" { const timers: TimersModule; export = timers; }
declare module "timers/promises" { const timersPromises: TimersPromisesModule; export = timersPromises; }
declare module "node:timers" { const timers: TimersModule; export = timers; }
declare module "node:timers/promises" { const timersPromises: TimersPromisesModule; export = timersPromises; }

/**
 * Engine-internal primitives of the timers module and the shell's job control (not a public API; ids and ticks).
 * See JSLoopModule.
 */
interface InternalLoopModule {
    /** Start a timer calling `fn()` after `ticks` ticks (every `ticks` ticks if `repeat`), owned by the calling thread. */
    schedule(fn: () => void, ticks: number, repeat: boolean, ref: boolean, reuseId?: number): number;
    cancel(id: number): boolean;
    refresh(id: number): boolean;
    ref(id: number, ref: boolean): void;
    /** A keep-alive handle owned by the calling thread: while ref'd, the thread is not idle. */
    handle(): number;
    handleRef(id: number, ref: boolean): void;
    handleClose(id: number): void;
    /** Block until the calling thread is idle (`true`) or `wakeIdle()` is called (`false`). */
    waitIdle(): boolean;
    wakeIdle(): void;
    /** The value attached to the calling thread (or its nearest ancestor) with setContext, inherited by descendants. */
    context(): unknown;
    /**
     * Attach a value to the calling thread (undefined: none, so the ancestors' context applies again), and the id of the
     * TTY the program runs on (Ctrl+C on that TTY reaches it). The thread becomes where the program's foreground starts.
     */
    setContext(value: unknown, tty?: number): void;
}

declare function require(id: "internal/loop"): InternalLoopModule;
declare module "internal/loop" { const loop: InternalLoopModule; export = loop; }
