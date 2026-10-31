// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/timers.ts — Node's `timers`: setTimeout/setInterval/setImmediate and their clear* functions (#45). The
// bios installs them as globals (internal/globals); `require('timers')` / `require('node:timers')` return the same
// functions.
//
// Timers run on game ticks: a delay in milliseconds is rounded up to whole ticks (1 tick = 50 ms), with a minimum of
// one tick, so `setTimeout(cb, 0)` runs on the next tick at the earliest. The queue itself is native (the engine's
// `internal/loop` module, see JSTimers): every pending timer has one CC timer, timers due in the same tick run in
// due-time / creation order, and — like events.on listeners — a callback runs in the thread that created the timer,
// may block, and is discarded when that thread is stopped (Ctrl+C, parallel stop). A ref'd pending timer (the
// default) keeps a shell job alive, as it keeps a Node process alive; unref() releases it.

import loop from 'internal/loop';
import events from 'events';

const MS_PER_TICK = 50;
/** Node's maximum delay; longer (and invalid) delays become 1 ms, as in Node. */
const TIMEOUT_MAX = 2147483647;

/** Pending timers by id, so clearTimeout() also takes the numeric id (`Number(timeout)`). */
const pending = new Map<number, Timeout>();

function invalidCallback(value: unknown): TypeError {
    let err = new TypeError('The "callback" argument must be of type function. Received ' +
        (value === null ? 'null' : typeof value));
    (err as any).code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

/** Node's delay coercion: anything that is not a number in [1, TIMEOUT_MAX] becomes 1 ms. */
function toDelay(delay: unknown): number {
    let ms = Number(delay);
    return ms >= 1 && ms <= TIMEOUT_MAX ? ms : 1;
}

function toTicks(ms: number): number {
    return Math.max(1, Math.ceil(ms / MS_PER_TICK));
}

function arm(t: Timeout, reuse: number): void {
    t._id = loop.schedule(t._fire, t._ticks, t._repeat !== null, t._ref, reuse);
    t._destroyed = false;
    pending.set(t._id, t);
}

/** A pending `setTimeout`/`setInterval` timer (Node's `Timeout`). */
class Timeout {
    declare _id: number;
    declare _idleTimeout: number;
    declare _repeat: number | null;
    declare _onTimeout: (...args: any[]) => void;
    declare _args: unknown[];
    declare _ticks: number;
    declare _ref: boolean;
    /** The timer has fired (a one-shot timer) or was cleared. */
    declare _destroyed: boolean;
    declare _cleared: boolean;
    declare _fire: () => void;

    constructor(callback: (...args: any[]) => void, delay: unknown, args: unknown[], repeat: boolean) {
        let ms = toDelay(delay);
        this._idleTimeout = ms;
        this._repeat = repeat ? ms : null;
        this._onTimeout = callback;
        this._args = args;
        this._ticks = toTicks(ms);
        this._ref = true;
        this._cleared = false;
        // A plain JS function: the engine enters it with continuations, so the callback may block.
        this._fire = () => {
            if (this._repeat === null) {
                this._destroyed = true;
                pending.delete(this._id);
            }
            this._onTimeout.apply(this, this._args);
        };
        arm(this, 0);
    }

    ref(): this {
        this._ref = true;
        if (!this._destroyed) loop.ref(this._id, true);
        return this;
    }

    unref(): this {
        this._ref = false;
        if (!this._destroyed) loop.ref(this._id, false);
        return this;
    }

    hasRef(): boolean {
        return this._ref;
    }

    /** Restart the countdown from now with the same delay; also re-arms a timer that has already fired (not a cleared one). */
    refresh(): this {
        if (this._cleared) return this;
        if (!loop.refresh(this._id)) arm(this, this._id);
        return this;
    }

    close(): this {
        clearTimeout(this);
        return this;
    }

    [Symbol.toPrimitive](): number {
        return this._id;
    }
}

/** A pending `setImmediate` callback (Node's `Immediate`). */
class Immediate {
    declare _id: number;
    declare _onImmediate: (...args: any[]) => void;
    declare _args: unknown[];
    declare _ref: boolean;
    declare _destroyed: boolean;

    constructor(callback: (...args: any[]) => void, args: unknown[]) {
        this._onImmediate = callback;
        this._args = args;
        this._ref = true;
        this._destroyed = false;
        this._id = events.setImmediate(() => {
            this._destroyed = true;
            this._onImmediate.apply(this, this._args);
        });
    }

    // An immediate runs on the next tick anyway: ref()/unref() only change hasRef(), a pending immediate always keeps
    // a job alive until it has run.
    ref(): this { this._ref = true; return this; }
    unref(): this { this._ref = false; return this; }
    hasRef(): boolean { return this._ref; }
}

function setTimeout(callback: (...args: any[]) => void, delay?: number, ...args: unknown[]): Timeout {
    if (typeof callback !== 'function') throw invalidCallback(callback);
    return new Timeout(callback, delay, args, false);
}

function setInterval(callback: (...args: any[]) => void, delay?: number, ...args: unknown[]): Timeout {
    if (typeof callback !== 'function') throw invalidCallback(callback);
    return new Timeout(callback, delay, args, true);
}

/** Cancel a timeout or interval; also takes its numeric id (or that id as a string). Anything else is ignored. */
function clearTimeout(timeout: Timeout | string | number | undefined | null): void {
    let t: Timeout | undefined;
    if (timeout instanceof Timeout) {
        t = timeout;
    } else if (typeof timeout === 'number' || typeof timeout === 'string') {
        t = pending.get(Number(timeout));
    }
    if (t === undefined || t._cleared) return;
    t._cleared = true;
    t._destroyed = true;
    pending.delete(t._id);
    loop.cancel(t._id);
}

function setImmediate(callback: (...args: any[]) => void, ...args: unknown[]): Immediate {
    if (typeof callback !== 'function') throw invalidCallback(callback);
    return new Immediate(callback, args);
}

function clearImmediate(immediate: Immediate | undefined | null): void {
    if (!(immediate instanceof Immediate) || immediate._destroyed) return;
    immediate._destroyed = true;
    events.clearImmediate(immediate._id);
}

// Exported with their public types (types/timers.d.ts, where Timeout and Immediate are interfaces).
const publicSetTimeout = setTimeout as TimersModule['setTimeout'];
const publicClearTimeout = clearTimeout as TimersModule['clearTimeout'];
const publicSetInterval = setInterval as TimersModule['setInterval'];
const publicSetImmediate = setImmediate as TimersModule['setImmediate'];
const publicClearImmediate = clearImmediate as TimersModule['clearImmediate'];
export {
    publicSetTimeout as setTimeout,
    publicClearTimeout as clearTimeout,
    publicSetInterval as setInterval,
    publicClearTimeout as clearInterval,
    publicSetImmediate as setImmediate,
    publicClearImmediate as clearImmediate,
};

// timers.promises, loaded on first use (timers/promises imports this module): a getter on the exports object.
export declare const promises: TimersPromisesModule;
Object.defineProperty(exports, 'promises', {
    get: function () { return require('/rom/lib/timers/promises'); },
    enumerable: true, configurable: true,
});

// The exports implement the module's public type (types/timers.d.ts).
type Exports<T extends TimersModule> = T;
type _Exports = Exports<typeof import('/rom/lib/timers')>;
