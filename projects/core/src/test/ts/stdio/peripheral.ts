// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The peripheral module (#61): devices by id, side or /dev path; list / get / wrap / find. Run by StdioLibraryTest
// with a hub on the top (which attaches `thing_7`, as a wired modem attaches its network) and a thing on the left.

import * as prelude from './prelude';
import asyncMod from 'async';
import peripheral from 'peripheral';
import peripheralPromises from 'peripheral/promises';
import fs from 'fs';
import system from 'system';

const eq = prelude.eq, throws = prelude.throws;

/** Compare arrays and plain objects by value. */
function same(actual: unknown, expected: unknown, message?: string): void {
    eq(JSON.stringify(actual), JSON.stringify(expected), message);
}

interface Thing extends IPeripheral {
    which(): string;
    name(): string;
}

// The native functions, by id or side.
same(peripheral.getNames(), ['hub_top', 'thing_7', 'thing_left']);
eq(peripheral.getDeviceOn('left'), 'thing_left');
eq(peripheral.isPresent('thing_7'), true);
eq(peripheral.isPresent('left'), true, 'a side');
eq(peripheral.isPresent('/dev/thing0'), false, 'no /dev entry before the OS names the devices');
eq(peripheral.call('thing_7', 'which'), 'hub');

// list / get: snapshots.
same(peripheral.list(), [
    { id: 'hub_top', types: ['hub'] },
    { id: 'thing_7', types: ['thing'] },
    { id: 'thing_left', types: ['thing'] },
]);
same(peripheral.get('thing_7'), { id: 'thing_7', types: ['thing'] });
same(peripheral.get('left'), { id: 'thing_left', types: ['thing'] }, 'a side gives the device on it');
eq(peripheral.get('thing_8'), undefined);
eq(Object.isFrozen(peripheral.get('thing_7')), true);

// wrap: the device's methods as an object.
let thing = peripheral.wrap('thing_7') as unknown as Device<Thing>;
eq(thing.id, 'thing_7');
eq(thing.type, 'thing');
same(thing.types, ['thing']);
eq(thing.which(), 'hub');
eq(thing.name(), 'thing_7', 'the attachment name is the id');
eq((peripheral.wrap('left') as unknown as Device<Thing>).id, 'thing_left', 'by side, named by id');
eq(peripheral.wrap('nothing'), undefined);

// find: every device of a type, wrapped.
same(peripheral.find('thing').map((d) => d.id), ['thing_7', 'thing_left']);
same(peripheral.find('thing', (d) => (d as unknown as Thing).which() === 'left').map((d) => d.id), ['thing_left']);
same(peripheral.find('monitor'), []);
throws(() => peripheral.find(1 as any), 'ERR_INVALID_ARG_TYPE');
throws(() => peripheral.find('thing', 'x' as any), 'ERR_INVALID_ARG_TYPE');

// The promises module.
eq(asyncMod.unwrap(peripheralPromises.call('thing_7', 'which')), 'hub');
same(asyncMod.unwrap(peripheralPromises.list()).map((d) => d.id), ['hub_top', 'thing_7', 'thing_left']);
same(asyncMod.unwrap(peripheralPromises.getType('left')), ['thing']);

// ── /dev (the OS's registry, started here by hand) ──────────────────────────────────────────────────────────────────

const devices = require('/rom/lib/internal/devices') as { start(): number };
eq(devices.start(), 3, 'three devices named');
same(fs.readdirSync('/dev'), ['hub0', 'thing0', 'thing1'], 'per type, numbered from 0 in id order');
same(JSON.parse(fs.readFileSync('/dev/thing0', 'utf8')), { id: 'thing_7', types: ['thing'] });
let stats = fs.statSync('/dev/thing1');
eq(stats.isCharacterDevice(), true);
eq(stats.isFile(), false);
eq(stats.mode, 0o020444, 'a read-only character device');
eq(fs.statSync('/dev').isDirectory(), true);
same(fs.readdirSync('/dev', { withFileTypes: true }).map((d) => d.isCharacterDevice()), [true, true, true]);
throws(() => fs.writeFileSync('/dev/thing0', 'x'));
throws(() => fs.writeFileSync('/dev/new', 'x'));

eq(peripheral.get('thing_left')?.path, '/dev/thing1');
eq(peripheral.get('/dev/thing0')?.id, 'thing_7', 'a /dev path');
eq((peripheral.wrap('/dev/thing1') as unknown as Device<Thing>).which(), 'left');
eq(peripheral.call('/dev/thing0', 'name'), 'thing_7', 'call by path');
eq(peripheral.isPresent('/dev/thing0'), true);

// Attach and detach: events with the device, the lowest free number again.
let seen: string[] = [];
peripheral.on('attach', (d) => seen.push('+' + d.id + '=' + d.path));
peripheral.on('detach', (d) => seen.push('-' + d.id + '=' + d.path));
throws(() => (peripheral as any).on('change', () => {}), 'ERR_INVALID_ARG_VALUE');
peripheral.call('top', 'detach7');
system.sleep(1);
same(fs.readdirSync('/dev'), ['hub0', 'thing1']);
peripheral.call('top', 'attach9');
system.sleep(1);
same(seen, ['-thing_7=/dev/thing0', '+thing_9=/dev/thing0'], 'the freed number is reused');
same(JSON.parse(fs.readFileSync('/dev/thing0', 'utf8')).id, 'thing_9');
