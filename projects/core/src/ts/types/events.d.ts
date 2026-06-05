// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `events` — the global event bus (singleton).
//
// Note: Node's `events` module exports the `EventEmitter` *class*. Here `events` is
// deliberately a global singleton emitter for the single CC event queue. The emitter API
// (`on`/`once`/`off`/`emit`) is preferred; `pullEvent` is the blocking low-level variant.

/** An event as `[name, ...args]`. */
type Event = [string, ...unknown[]];

/** Listener for a queued event. Receives the event arguments (without the name). */
type EventListener = (...args: unknown[]) => void;

interface EventsModule {
    on(event: string, cb: EventListener): void;
    once(event: string, cb: EventListener): void;
    off(event: string, cb: EventListener): void;

    /** Push an event onto the queue. `queueEvent` is an alias. */
    emit(name: string, ...args: unknown[]): void;
    queueEvent(name: string, ...args: unknown[]): void;

    /** Blocking, low-level: wait for the next (optionally filtered) event. */
    pullEvent(filter?: string): Event;
    /** Blocking, low-level: like {@link pullEvent} but without `terminate` handling. */
    pullEventRaw(filter?: string): Event;

    // --- CC low-level timers/alarms (they fire events) ---
    /** Start a timer; fires a `timer` event with the returned id after `seconds`. */
    startTimer(seconds: number): number;
    cancelTimer(id: number): void;
    /** Set an alarm at an in-game time [0, 24); fires an `alarm` event with the returned id. */
    setAlarm(time: number): number;
    cancelAlarm(id: number): void;
}
