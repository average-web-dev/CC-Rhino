// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/system/promises.ts — `system/promises`: the native `internal/system/promises` (sleep, timers, … as
// promises) plus the process table of `system`.

import native from 'internal/system/promises';
import * as system from '/rom/lib/system';

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

export function processes(): Promise<ProcessInfo[]> {
    return Promise.resolve().then(() => system.processes());
}

export function process(pid: number): Promise<ProcessInfo | undefined> {
    return Promise.resolve().then(() => system.process(pid));
}

// The exports implement the module's public type (types/system.d.ts).
type Exports<T extends SystemModulePromises> = T;
type _Exports = Exports<typeof import('/rom/lib/system/promises')>;
