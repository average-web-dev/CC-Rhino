// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/peripheral/promises.ts — `peripheral/promises`: the native `internal/peripheral/promises` (device calls as
// promises) plus list() / get() of `peripheral`. Devices are given by id, /dev path or side.

import native from 'internal/peripheral/promises';
import * as peripheral from '/rom/lib/peripheral';

/** The id of a device given by id, /dev path or side. */
function idOf(idOrPath: string): string {
    return peripheral.get(idOrPath)?.id ?? idOrPath;
}

export const getNames = native.getNames;
export const getDeviceOn = native.getDeviceOn;

export function isPresent(idOrPath: string): Promise<boolean> {
    return native.isPresent(idOf(idOrPath));
}

export function getType(idOrPath: string): Promise<string[] | null> {
    return native.getType(idOf(idOrPath));
}

export function hasType(idOrPath: string, type: string): Promise<boolean | null> {
    return native.hasType(idOf(idOrPath), type);
}

export function getMethods(idOrPath: string): Promise<string[] | null> {
    return native.getMethods(idOf(idOrPath));
}

export function call(idOrPath: string, method: string, ...args: unknown[]): Promise<unknown> {
    return native.call(idOf(idOrPath), method, ...args);
}

export function list(): Promise<DeviceInfo[]> {
    return Promise.resolve().then(() => peripheral.list());
}

export function get(idOrPath: string): Promise<DeviceInfo | undefined> {
    return Promise.resolve().then(() => peripheral.get(idOrPath));
}

// The exports implement the module's public type (types/peripheral.d.ts).
type Exports<T extends PeripheralModulePromises> = T;
type _Exports = Exports<typeof import('/rom/lib/peripheral/promises')>;
