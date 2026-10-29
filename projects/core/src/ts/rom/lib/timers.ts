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
// may block, and is discarded when that thread is stopped (Ctrl+T, parallel stop). A ref'd pending timer (the
// default) keeps a shell job alive, as it keeps a Node process alive; unref() releases it.

const loop = require('internal/loop');
const events = require('events');

const MS_PER_TICK = 50;
/** Node's maximum delay; longer (and invalid) delays become 1 ms, as in Node. */
const TIMEOUT_MAX = 2147483647;

interface TimeoutState extends Timeout {
    _id: number;
    _idleTimeout: number;
    _repeat: number | null;
    _onTimeout: (...args: any[]) => void;
    _args: unknown[];
    _ticks: number;
    _ref: boolean;
    /** The timer has fired (a one-shot timer) or was cleared. */
    _destroyed: boolean;
    _cleared: boolean;
    _fire: () => void;
}

interface ImmediateState extends Immediate {
    _id: number;
    _onImmediate: (...args: any[]) => void;
    _args: unknown[];
    _ref: boolean;
    _destroyed: boolean;
}

/** Pending timers by id, so clearTimeout() also takes the numeric id (`Number(timeout)`). */
const pending = new Map<number, TimeoutState>();

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

function arm(t: TimeoutState, reuse: number): void {
    t._id = loop.schedule(t._fire, t._ticks, t._repeat !== null, t._ref, reuse);
    t._destroyed = false;
    pending.set(t._id, t);
}

const Timeout = function (this: TimeoutState, callback: (...args: any[]) => void, delay: unknown, args: unknown[],
                          repeat: boolean): void {
    let self = this;
    let ms = toDelay(delay);
    self._idleTimeout = ms;
    self._repeat = repeat ? ms : null;
    self._onTimeout = callback;
    self._args = args;
    self._ticks = toTicks(ms);
    self._ref = true;
    self._cleared = false;
    // A plain function: the engine enters it with continuations, so the callback may block.
    self._fire = function () {
        if (self._repeat === null) {
            self._destroyed = true;
            pending.delete(self._id);
        }
        self._onTimeout.apply(self, self._args);
    };
    arm(self, 0);
} as unknown as { new(callback: (...args: any[]) => void, delay: unknown, args: unknown[], repeat: boolean): TimeoutState };

Timeout.prototype.ref = function (this: TimeoutState) {
    this._ref = true;
    if (!this._destroyed) loop.ref(this._id, true);
    return this;
};
Timeout.prototype.unref = function (this: TimeoutState) {
    this._ref = false;
    if (!this._destroyed) loop.ref(this._id, false);
    return this;
};
Timeout.prototype.hasRef = function (this: TimeoutState) {
    return this._ref;
};
/** Restart the countdown from now with the same delay; also re-arms a timer that has already fired (not a cleared one). */
Timeout.prototype.refresh = function (this: TimeoutState) {
    if (this._cleared) return this;
    if (!loop.refresh(this._id)) arm(this, this._id);
    return this;
};
Timeout.prototype.close = function (this: TimeoutState) {
    clearTimeout(this);
    return this;
};
(Timeout.prototype as any)[Symbol.toPrimitive] = function (this: TimeoutState) {
    return this._id;
};

const Immediate = function (this: ImmediateState, callback: (...args: any[]) => void, args: unknown[]): void {
    let self = this;
    self._onImmediate = callback;
    self._args = args;
    self._ref = true;
    self._destroyed = false;
    self._id = events.setImmediate(function () {
        self._destroyed = true;
        self._onImmediate.apply(self, self._args);
    });
} as unknown as { new(callback: (...args: any[]) => void, args: unknown[]): ImmediateState };

// An immediate runs on the next tick anyway: ref()/unref() only change hasRef(), a pending immediate always keeps a
// job alive until it has run.
Immediate.prototype.ref = function (this: ImmediateState) { this._ref = true; return this; };
Immediate.prototype.unref = function (this: ImmediateState) { this._ref = false; return this; };
Immediate.prototype.hasRef = function (this: ImmediateState) { return this._ref; };

// The public functions read `arguments` rather than using rest parameters: Rhino mixes up rest parameters when a
// function is called through Function.prototype.apply.

function setTimeout(callback: (...args: any[]) => void, delay?: number): Timeout {
    if (typeof callback !== 'function') throw invalidCallback(callback);
    return new Timeout(callback, delay, Array.prototype.slice.call(arguments, 2), false);
}

function setInterval(callback: (...args: any[]) => void, delay?: number): Timeout {
    if (typeof callback !== 'function') throw invalidCallback(callback);
    return new Timeout(callback, delay, Array.prototype.slice.call(arguments, 2), true);
}

/** Cancel a timeout or interval; also takes its numeric id (or that id as a string). Anything else is ignored. */
function clearTimeout(timeout: Timeout | string | number | undefined | null): void {
    let t: TimeoutState | undefined;
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

function setImmediate(callback: (...args: any[]) => void): Immediate {
    if (typeof callback !== 'function') throw invalidCallback(callback);
    return new Immediate(callback, Array.prototype.slice.call(arguments, 1));
}

function clearImmediate(immediate: Immediate | undefined | null): void {
    if (!(immediate instanceof Immediate) || immediate._destroyed) return;
    immediate._destroyed = true;
    events.clearImmediate(immediate._id);
}

const timers = {
    setTimeout: setTimeout as TimersModule['setTimeout'],
    clearTimeout,
    setInterval: setInterval as TimersModule['setInterval'],
    clearInterval: clearTimeout,
    setImmediate: setImmediate as TimersModule['setImmediate'],
    clearImmediate,
} as TimersModule;

// timers.promises, loaded on first use (timers/promises requires this module).
Object.defineProperty(timers, 'promises', {
    get: function () { return require('/rom/lib/timers/promises'); },
    enumerable: true, configurable: true,
});

export = timers;
