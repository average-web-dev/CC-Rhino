// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/timers/promises.ts — Node's `timers/promises` (#45): setTimeout/setImmediate returning promises,
// setInterval as an async iterator, and `scheduler.wait`/`scheduler.yield`. Built on /rom/lib/timers, so delays are
// rounded up to whole ticks and the timers belong to the calling thread.
//
// `options.ref = false` unrefs the timer (it does not keep a shell job alive). There is no AbortController in this
// runtime, so `options.signal` is not supported.

import * as timers from '/rom/lib/timers';

function invalidOptions(): TypeError {
    let err = new TypeError('The "options" argument must be of type object');
    (err as any).code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

/** Whether `options` asks for a ref'd timer; throws for options that are not an object. */
function isRef(options: TimerOptions | undefined): boolean {
    if (options === undefined) return true;
    if (options === null || typeof options !== 'object') throw invalidOptions();
    return options.ref !== false;
}

export function setTimeout<T = void>(delay?: number, value?: T, options?: TimerOptions): Promise<T> {
    let ref: boolean;
    try {
        ref = isRef(options);
    } catch (e) {
        return Promise.reject(e);
    }
    return new Promise<T>(function (resolve) {
        let t = timers.setTimeout(resolve, delay, value as T);
        if (!ref) t.unref();
    });
}

export function setImmediate<T = void>(value?: T, options?: TimerOptions): Promise<T> {
    let ref: boolean;
    try {
        ref = isRef(options);
    } catch (e) {
        return Promise.reject(e);
    }
    return new Promise<T>(function (resolve) {
        let i = timers.setImmediate(resolve, value as T);
        if (!ref) i.unref();
    });
}

/**
 * An async iterator that yields `value` every `delay` ms, for `for await`. The interval starts at once; ticks that
 * fire while nobody waits are queued, as in Node. Leaving the loop (`break`, `return`, an error) calls `return()`,
 * which clears the interval.
 */
export function setInterval<T = void>(delay?: number, value?: T, options?: TimerOptions): AsyncIterableIterator<T> {
    let ref = isRef(options);
    let fired = 0;
    let done = false;
    let waiting: ((result: IteratorResult<T>) => void)[] = [];
    let interval = timers.setInterval(function () {
        let next = waiting.shift();
        if (next !== undefined) next({ value: value as T, done: false }); else fired++;
    }, delay);
    if (!ref) interval.unref();

    let iterator = {
        next(): Promise<IteratorResult<T>> {
            if (done) return Promise.resolve({ value: undefined as any, done: true });
            if (fired > 0) {
                fired--;
                return Promise.resolve({ value: value as T, done: false });
            }
            return new Promise<IteratorResult<T>>(function (resolve) { waiting.push(resolve); });
        },
        return(): Promise<IteratorResult<T>> {
            done = true;
            timers.clearInterval(interval);
            let pendingNext = waiting;
            waiting = [];
            for (let resolve of pendingNext) resolve({ value: undefined as any, done: true });
            return Promise.resolve({ value: undefined as any, done: true });
        },
    } as AsyncIterableIterator<T>;
    (iterator as any)[Symbol.asyncIterator] = function () { return iterator; };
    return iterator;
}

export const scheduler: TimersPromisesModule['scheduler'] = {
    wait(delay: number, options?: TimerOptions): Promise<void> { return setTimeout<void>(delay, undefined, options); },
    yield(): Promise<void> { return setImmediate<void>(); },
};

// The exports implement the module's public type (types/timers.d.ts).
type Exports<T extends TimersPromisesModule> = T;
type _Exports = Exports<typeof import('/rom/lib/timers/promises')>;
