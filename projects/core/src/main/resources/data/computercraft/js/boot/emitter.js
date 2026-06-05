// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

// Boot script — evaluated in the global scope before bios.js runs.
//
// Defines the Node-compatible EventEmitter the runtime is built on, and the
// shared instance + Promise factory the Java host captures at construction
// (__emitter__ routes native CC events to os.on/once/off; __createPromise__
// lets the host resolve pull-event callbacks). The EventEmitter class is also
// exposed globally so rom modules can `new EventEmitter()` without importing.

class EventEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn) { (this._listeners[event] ??= []).push({ fn, once: false }); return this; }
    once(event, fn) { (this._listeners[event] ??= []).push({ fn, once: true }); return this; }
    off(event, fn) {
        const ls = this._listeners[event];
        if (ls) this._listeners[event] = ls.filter(l => l.fn !== fn);
        return this;
    }
    emit(event, ...args) {
        const ls = this._listeners[event];
        if (!ls || ls.length === 0) return false;
        const snapshot = [...ls];
        this._listeners[event] = ls.filter(l => !l.once);
        for (const l of snapshot) l.fn(...args);
        return true;
    }
    listenerCount(event) { return (this._listeners[event] ?? []).length; }
}

globalThis.EventEmitter = EventEmitter;
globalThis.__emitter__ = new EventEmitter();
globalThis.__createPromise__ = cb => new Promise(cb);
