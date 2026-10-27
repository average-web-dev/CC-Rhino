// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/emitter.ts — a plain JS EventEmitter (the core of Node's `events.EventEmitter`), used by the ROM's
// Node-style objects (readline interfaces, …). Not a public module: `require('events')` is the computer's event bus.
//
// Listeners run synchronously in the emitting thread, in registration order. emit() uses a plain loop, so listeners
// may call blocking APIs when emit() itself was called from code that can block (see #38).
//
// Rhino has no `class` syntax, so this is a constructor function; "subclasses" chain their prototype to
// EventEmitter.prototype and call EventEmitter.call(this) from their constructor.

type Listener = (...args: any[]) => void;

interface EventEmitter {
    on(event: string | symbol, listener: Listener): this;
    addListener(event: string | symbol, listener: Listener): this;
    prependListener(event: string | symbol, listener: Listener): this;
    once(event: string | symbol, listener: Listener): this;
    prependOnceListener(event: string | symbol, listener: Listener): this;
    off(event: string | symbol, listener: Listener): this;
    removeListener(event: string | symbol, listener: Listener): this;
    removeAllListeners(event?: string | symbol): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    listenerCount(event: string | symbol): number;
    listeners(event: string | symbol): Listener[];
    eventNames(): (string | symbol)[];
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
}

interface EventEmitterConstructor {
    new(): EventEmitter;
    (this: EventEmitter): void;
    prototype: EventEmitter;
}

/** One registration; `once` registrations are removed before their listener runs. */
interface Entry { fn: Listener; once: boolean; }

interface EmitterState { __events?: Record<string | symbol, Entry[] | undefined>; }

function table(self: EventEmitter): Record<string | symbol, Entry[] | undefined> {
    let state = self as EmitterState;
    if (state.__events === undefined) {
        Object.defineProperty(self, '__events', { value: Object.create(null), writable: true, configurable: true });
    }
    return state.__events!;
}

function checkListener(listener: unknown): void {
    if (typeof listener !== 'function') {
        let err = new TypeError('The "listener" argument must be of type function');
        (err as any).code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

function add(self: EventEmitter, event: string | symbol, fn: Listener, once: boolean, prepend: boolean): EventEmitter {
    checkListener(fn);
    let events = table(self);
    // Like Node: 'newListener' is emitted before the listener is added.
    if (events['newListener'] !== undefined) self.emit('newListener', event, fn);
    let list = events[event] ?? (events[event] = []);
    let entry: Entry = { fn, once };
    if (prepend) list.unshift(entry); else list.push(entry);
    return self;
}

const EventEmitter = function (this: EventEmitter) {
    table(this);
} as unknown as EventEmitterConstructor;

const proto = EventEmitter.prototype;

proto.on = function (this: EventEmitter, event, listener) { return add(this, event, listener, false, false); };
proto.addListener = proto.on;
proto.prependListener = function (this: EventEmitter, event, listener) { return add(this, event, listener, false, true); };
proto.once = function (this: EventEmitter, event, listener) { return add(this, event, listener, true, false); };
proto.prependOnceListener = function (this: EventEmitter, event, listener) {
    return add(this, event, listener, true, true);
};

proto.off = function (this: EventEmitter, event, listener) {
    checkListener(listener);
    let events = table(this);
    let list = events[event];
    if (list === undefined) return this;
    // Remove the most recently added registration, as Node does.
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].fn === listener) {
            list.splice(i, 1);
            if (list.length === 0) delete events[event];
            if (events['removeListener'] !== undefined) this.emit('removeListener', event, listener);
            break;
        }
    }
    return this;
};
proto.removeListener = proto.off;

proto.removeAllListeners = function (this: EventEmitter, event?: string | symbol) {
    let events = table(this);
    if (event === undefined) {
        Object.defineProperty(this, '__events', { value: Object.create(null), writable: true, configurable: true });
    } else {
        delete events[event];
    }
    return this;
};

// (`arguments` rather than a rest parameter: Rhino mixes up `event, ...args` when emit is applied.)
proto.emit = function (this: EventEmitter, event: string | symbol) {
    let args: any[] = Array.prototype.slice.call(arguments, 1);
    let list = table(this)[event];
    if (list === undefined || list.length === 0) {
        if (event === 'error') {
            let err = args[0];
            if (err instanceof Error) throw err;
            let wrapped = new Error('Unhandled error. (' + String(err) + ')');
            (wrapped as any).code = 'ERR_UNHANDLED_ERROR';
            (wrapped as any).context = err;
            throw wrapped;
        }
        return false;
    }
    // Iterate over a snapshot, so listeners added or removed while emitting take effect from the next emit.
    let snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) {
        let entry = snapshot[i];
        if (entry.once) {
            let index = list.indexOf(entry);
            if (index < 0) continue; // already removed by an earlier listener
            list.splice(index, 1);
        }
        entry.fn.apply(this, args);
    }
    return true;
};

proto.listenerCount = function (this: EventEmitter, event) {
    let list = table(this)[event];
    return list === undefined ? 0 : list.length;
};

proto.listeners = function (this: EventEmitter, event) {
    let list = table(this)[event];
    let out: Listener[] = [];
    if (list !== undefined) for (let i = 0; i < list.length; i++) out.push(list[i].fn);
    return out;
};

proto.eventNames = function (this: EventEmitter) {
    let events = table(this);
    let names: (string | symbol)[] = Object.keys(events);
    return names.concat(Object.getOwnPropertySymbols(events));
};

// There is no listener-leak warning, so the limit is only stored.
proto.setMaxListeners = function (this: EventEmitter, n: number) {
    Object.defineProperty(this, '__maxListeners', { value: n, writable: true, configurable: true });
    return this;
};
proto.getMaxListeners = function (this: EventEmitter) {
    let n = (this as any).__maxListeners;
    return typeof n === 'number' ? n : 10;
};

export = EventEmitter;
