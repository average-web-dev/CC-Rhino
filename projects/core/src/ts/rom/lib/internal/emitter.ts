// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/emitter.ts — a plain JS EventEmitter (the core of Node's `events.EventEmitter`), used by the ROM's
// Node-style objects (readline interfaces, …). Not a public module: `require('events')` is the computer's event bus.
//
// Listeners run synchronously in the emitting thread, in registration order. emit() uses a plain loop, so listeners
// may call blocking APIs when emit() itself was called from code that can block (see #38).

type Listener = (...args: any[]) => void;

/** One registration; `once` registrations are removed before their listener runs. */
interface Entry { fn: Listener; once: boolean; }

type EventTable = Record<string | symbol, Entry[] | undefined>;

function checkListener(listener: unknown): void {
    if (typeof listener !== 'function') {
        let err = new TypeError('The "listener" argument must be of type function');
        (err as any).code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

/** A non-enumerable own property, so the emitter's state does not show up in util.inspect & co. */
function hide(self: object, name: string, value: unknown): void {
    Object.defineProperty(self, name, { value, writable: true, configurable: true });
}

/** The listeners by event, created on first use (also for objects that did not run the constructor). */
function table(self: EventEmitter): EventTable {
    let state = self as unknown as { __events?: EventTable };
    if (state.__events === undefined) hide(self, '__events', Object.create(null));
    return state.__events!;
}

function add<T extends EventEmitter>(self: T, event: string | symbol, fn: Listener, once: boolean, prepend: boolean): T {
    checkListener(fn);
    let events = table(self);
    // Like Node: 'newListener' is emitted before the listener is added.
    if (events['newListener'] !== undefined) self.emit('newListener', event, fn);
    let list = events[event] ?? (events[event] = []);
    let entry: Entry = { fn, once };
    if (prepend) list.unshift(entry); else list.push(entry);
    return self;
}

class EventEmitter {
    constructor() {
        table(this);
    }

    on(event: string | symbol, listener: Listener): this { return add(this, event, listener, false, false); }
    prependListener(event: string | symbol, listener: Listener): this { return add(this, event, listener, false, true); }
    once(event: string | symbol, listener: Listener): this { return add(this, event, listener, true, false); }
    prependOnceListener(event: string | symbol, listener: Listener): this { return add(this, event, listener, true, true); }

    off(event: string | symbol, listener: Listener): this {
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
    }

    removeAllListeners(event?: string | symbol): this {
        if (event === undefined) hide(this, '__events', Object.create(null));
        else delete table(this)[event];
        return this;
    }

    emit(event: string | symbol, ...args: any[]): boolean {
        let list = table(this)[event];
        if (list === undefined || list.length === 0) {
            if (event === 'error') {
                let err = args[0];
                if (err instanceof Error) throw err;
                let wrapped = new Error(`Unhandled error. (${String(err)})`);
                (wrapped as any).code = 'ERR_UNHANDLED_ERROR';
                (wrapped as any).context = err;
                throw wrapped;
            }
            return false;
        }
        // Iterate over a snapshot, so listeners added or removed while emitting take effect from the next emit.
        for (const entry of list.slice()) {
            if (entry.once) {
                let index = list.indexOf(entry);
                if (index < 0) continue; // already removed by an earlier listener
                list.splice(index, 1);
            }
            entry.fn.apply(this, args);
        }
        return true;
    }

    listenerCount(event: string | symbol): number {
        return table(this)[event]?.length ?? 0;
    }

    listeners(event: string | symbol): Listener[] {
        return (table(this)[event] ?? []).map((entry) => entry.fn);
    }

    eventNames(): (string | symbol)[] {
        let events = table(this);
        return [...Object.keys(events), ...Object.getOwnPropertySymbols(events)];
    }

    // There is no listener-leak warning, so the limit is only stored.
    setMaxListeners(n: number): this {
        hide(this, '__maxListeners', n);
        return this;
    }

    getMaxListeners(): number {
        let n = (this as unknown as { __maxListeners?: number }).__maxListeners;
        return typeof n === 'number' ? n : 10;
    }
}

// Aliases are the same functions, as in Node.
interface EventEmitter {
    addListener: EventEmitter['on'];
    removeListener: EventEmitter['off'];
}
EventEmitter.prototype.addListener = EventEmitter.prototype.on;
EventEmitter.prototype.removeListener = EventEmitter.prototype.off;

export = EventEmitter;
