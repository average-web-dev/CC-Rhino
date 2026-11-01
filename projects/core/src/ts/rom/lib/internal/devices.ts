// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/devices.ts — the OS's device registry (#61): names every attached device and keeps /dev in step.
//
// A device is named after its primary type (without a mod prefix: `minecraft:chest` → `chest`) and the lowest number
// free for that type, as Linux names sda, sdb: `/dev/monitor0`, `/dev/monitor1`, … with no gaps; a name stays while
// its device is attached and is reused after it went. The file holds `{"id":…,"types":[…]}` (a character device).
// The registry follows the `peripheral` / `peripheral_detach` events and emits `device_attach` / `device_detach`
// (DeviceInfo) on the event bus, which peripheral.on('attach' | 'detach') listens to. The OS starts it at boot.

import native from 'internal/peripheral';
import events from 'events';

/** The name of each device, by id. */
const names = new Map<string, string>();
const infos = new Map<string, DeviceInfo>();
let started = false;

/** The base of a device's name: its primary type, without a mod prefix, as a plain file name. */
function baseName(type: string): string {
    let base = type.slice(type.lastIndexOf(':') + 1).replace(/[^A-Za-z0-9_]/g, '_');
    return base === '' ? 'device' : base;
}

function nameFor(type: string): string {
    let base = baseName(type);
    let used = new Set(names.values());
    let n = 0;
    while (used.has(base + n)) n++;
    return base + n;
}

function add(id: string, announce: boolean): void {
    if (names.has(id)) return;
    let types = native.getType(id);
    if (types === null) return;
    let name = nameFor(types[0]);
    let info: DeviceInfo = Object.freeze({ id, types: Object.freeze(types), path: '/dev/' + name });
    names.set(id, name);
    infos.set(id, info);
    native.setDeviceFile(name, JSON.stringify({ id, types }));
    if (announce) events.emit('device_attach', info);
}

function remove(id: string): void {
    let name = names.get(id), info = infos.get(id);
    if (name === undefined || info === undefined) return;
    names.delete(id);
    infos.delete(id);
    native.removeDeviceFile(name);
    events.emit('device_detach', info);
}

/** Name the attached devices and follow attaches and detaches; returns how many devices there are. Once per boot. */
export function start(): number {
    if (!started) {
        started = true;
        for (let id of native.getNames()) add(id, false);
        events.on('peripheral', (id: string) => add(id, true));
        events.on('peripheral_detach', (id: string) => remove(id));
    }
    return names.size;
}

/** A named device, by id. */
export function infoOf(id: string): DeviceInfo | undefined {
    return infos.get(id);
}
