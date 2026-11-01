// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/peripheral.ts — `peripheral`: the computer's devices (#61). Everything of the native module
// `internal/peripheral`, plus:
//
//   peripheral.list()                       every device: DeviceInfo { id, types, path? }
//   peripheral.get('monitor_0')             one of them, or undefined
//   peripheral.wrap('/dev/monitor0')        its methods as an object (typed by the id / path), or undefined
//   peripheral.find('speaker')              every device of a type, wrapped
//
// A device has an id (`monitor_3`) that is the same on every computer and wherever it is attached: on a side or through
// a wired network, both alike. Every function that takes a device accepts its id, its /dev path, or (for
// compatibility) the side it is on.

import native from 'internal/peripheral';
import fs from 'fs';
import { validateFunction, validateString } from '/rom/lib/internal/validators';

const DEV = '/dev/';

/** The id of a device given by id, /dev path or side (unchanged if it is no /dev path). */
function idOf(idOrPath: string): string {
    validateString(idOrPath, 'idOrPath');
    if (!idOrPath.startsWith(DEV)) return idOrPath;
    try {
        let info = JSON.parse(fs.readFileSync(idOrPath, 'utf8')) as { id?: unknown };
        return typeof info.id === 'string' ? info.id : idOrPath;
    } catch {
        return idOrPath;
    }
}

/** The /dev path of a device, if the OS named it. */
function pathOf(id: string): string | undefined {
    let devices = fs.existsSync(DEV) ? fs.readdirSync(DEV) : [];
    for (let name of devices) {
        if (idOf(DEV + name) === id) return DEV + name;
    }
    return undefined;
}

function infoOf(id: string): DeviceInfo | undefined {
    let types = native.getType(id);
    if (types === null) return undefined;
    let path = pathOf(id);
    let info: { id: string; types: readonly string[]; path?: string } = { id, types: Object.freeze(types) };
    if (path !== undefined) info.path = path;
    return Object.freeze(info);
}

export const getNames = native.getNames;
export const getDeviceOn = native.getDeviceOn;

export function isPresent(idOrPath: string): boolean {
    return native.isPresent(idOf(idOrPath));
}

export function getType(idOrPath: string): string[] | null {
    return native.getType(idOf(idOrPath));
}

export function hasType(idOrPath: string, type: string): boolean | null {
    return native.hasType(idOf(idOrPath), type);
}

export function getMethods(idOrPath: string): string[] | null {
    return native.getMethods(idOf(idOrPath));
}

export function call(idOrPath: string, method: string, ...args: unknown[]): unknown {
    return native.call(idOf(idOrPath), method, ...args);
}

export function list(): DeviceInfo[] {
    let devices: DeviceInfo[] = [];
    for (let id of native.getNames()) {
        let info = infoOf(id);
        if (info !== undefined) devices.push(info);
    }
    return devices;
}

export function get(idOrPath: string): DeviceInfo | undefined {
    let id = idOf(idOrPath);
    // A side finds the device on it; the info carries the device's id.
    return infoOf(native.getDeviceOn(id) ?? id);
}

export function wrap<P extends string>(idOrPath: P): Device<DeviceTypeOf<P>> | undefined {
    let id = idOf(idOrPath);
    id = native.getDeviceOn(id) ?? id;
    let types = native.getType(id);
    let methods = native.getMethods(id);
    if (types === null || methods === null) return undefined;

    let device: Record<string, unknown> = { id, type: types[0], types: Object.freeze(types) };
    for (let method of methods) {
        device[method] = (...args: unknown[]) => native.call(id, method, ...args);
    }
    return Object.freeze(device) as unknown as Device<DeviceTypeOf<P>>;
}

export function find<K extends keyof PeripheralTypeMap>(type: K, filter?: (device: Device<PeripheralTypeMap[K]>) => boolean): Device<PeripheralTypeMap[K]>[];
export function find(type: string, filter?: (device: Device) => boolean): Device[];
export function find(type: string, filter?: (device: Device) => boolean): Device[] {
    validateString(type, 'type');
    if (filter !== undefined) validateFunction(filter, 'filter');
    let found: Device[] = [];
    for (let id of native.getNames()) {
        if (!native.hasType(id, type)) continue;
        let device = wrap(id);
        if (device !== undefined && (filter === undefined || filter(device))) found.push(device);
    }
    return found;
}

// The exports implement the module's public type (types/peripheral.d.ts).
type Exports<T extends PeripheralModule> = T;
type _Exports = Exports<typeof import('/rom/lib/peripheral')>;
