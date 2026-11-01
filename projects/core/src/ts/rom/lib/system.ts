// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/system.ts — `system`: the computer. Everything of the native module `internal/system` (id, label, clock,
// time, sleep, shutdown, timers, …), plus the running programs (#60):
//
//   system.processes()                        every running program (ProcessInfo: pid, ppid, argv, cwd, tty, …)
//   system.process(pid)                       one of them, or undefined
//   system.on('processStart', (p) => …)       a program started
//   system.on('processEnd', (p, code) => …)   a program ended
//   Signal.SIGTERM / SIGINT / SIGKILL         the signals (15, 2, 9) for process.kill() / child.kill()
//
// The events are `process_start` / `process_end` on the event bus, so a listener belongs to the thread that added it
// and goes away with its program. The process table itself is internal/tty's; it is loaded on first use, so the bios
// can use `system` before the ROM's job control exists.

import native from 'internal/system';
import events from 'events';
import { validateInteger, validateOneOf } from '/rom/lib/internal/validators';
import type * as Jobs from '/rom/lib/internal/tty';

export const startTimer = native.startTimer;
export const cancelTimer = native.cancelTimer;
export const setAlarm = native.setAlarm;
export const cancelAlarm = native.cancelAlarm;
export const shutdown = native.shutdown;
export const reboot = native.reboot;
export const getComputerID = native.getComputerID;
export const computerID = native.computerID;
export const getComputerLabel = native.getComputerLabel;
export const computerLabel = native.computerLabel;
export const setComputerLabel = native.setComputerLabel;
export const getHost = native.getHost;
export const clock = native.clock;
export const time = native.time;
export const day = native.day;
export const epoch = native.epoch;
export const sleep = native.sleep;
const yield_ = native.yield;
export { yield_ as yield };

function jobs(): typeof Jobs {
    return require('/rom/lib/internal/tty') as typeof Jobs;
}

export function processes(): ProcessInfo[] {
    let table = jobs();
    return table.processes().map(table.infoOf);
}

export function process(pid: number): ProcessInfo | undefined {
    validateInteger(pid, 'pid');
    let table = jobs();
    let job = table.processOf(pid);
    return job === undefined ? undefined : table.infoOf(job);
}

/** The signals, as on Linux (a constant group like Dye): process.kill(pid, Signal.SIGKILL). */
export const Signal = Object.freeze({ SIGINT: 2, SIGKILL: 9, SIGTERM: 15 } as const);
export type Signal = typeof Signal[keyof typeof Signal];

const EVENTS = { processStart: 'process_start', processEnd: 'process_end' } as const;
const EVENT_NAMES = Object.keys(EVENTS) as (keyof typeof EVENTS)[];

export function on<K extends keyof SystemEventMap>(event: K, listener: (...args: SystemEventMap[K]) => void): SystemModule {
    validateOneOf(event, 'event', EVENT_NAMES);
    events.on(EVENTS[event], listener as any);
    return module.exports as SystemModule;
}

export function once<K extends keyof SystemEventMap>(event: K, listener: (...args: SystemEventMap[K]) => void): SystemModule {
    validateOneOf(event, 'event', EVENT_NAMES);
    events.once(EVENTS[event], listener as any);
    return module.exports as SystemModule;
}

export function off<K extends keyof SystemEventMap>(event: K, listener: (...args: SystemEventMap[K]) => void): SystemModule {
    validateOneOf(event, 'event', EVENT_NAMES);
    events.off(EVENTS[event], listener as any);
    return module.exports as SystemModule;
}

// The exports implement the module's public type (types/system.d.ts).
type Exports<T extends SystemModule> = T;
type _Exports = Exports<typeof import('/rom/lib/system')>;
