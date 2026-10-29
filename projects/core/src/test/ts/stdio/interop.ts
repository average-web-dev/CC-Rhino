// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// ES module imports of native modules, ROM modules and compiled modules (#49), as Babel compiles them to CommonJS:
// default and named imports see the object `require()` returns; the namespace of a CommonJS module inherits from it,
// with `default` set to it.

import fs from 'fs';
import * as fsNamespace from 'fs';
import { existsSync, readFileSync } from 'fs';
import system, { getComputerID, sleep } from 'system';
import asyncMod from 'async';
import util from 'util';
import * as utilNamespace from 'util';
import { format } from 'util';
import nodeUtil from 'node:util';
import readline, { createInterface } from 'readline';
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import con from 'console';
import proc from 'process';
import * as procNamespace from 'process';
import greet, { answer, counter, increment } from './interop-lib';
import * as lib from './interop-lib';
import { eq } from './prelude';

// Native modules.
eq(fs, require('fs'), 'default import of a native module');
eq(fsNamespace.readFileSync, require('fs').readFileSync, 'namespace import of a native module');
eq((fsNamespace as unknown as { default: unknown }).default, fs, 'namespace default');
eq(Object.getPrototypeOf(fsNamespace), fs, 'the namespace inherits from the module');
eq(fsNamespace.existsSync('/interop-lib.js'), true);
eq(readFileSync, require('fs').readFileSync, 'named import of a native module');
// Named imports are called without a receiver.
eq(existsSync('/interop-lib.js'), true);
eq(readFileSync('/interop-lib.js', 'utf8').indexOf('greet') >= 0, true);
eq(getComputerID(), system.getComputerID());
// ... and may block.
let before = system.clock();
sleep(1);
eq(system.clock() > before, true, 'blocking call');

// ROM modules (CommonJS objects of named exports).
eq(util, require('util'), 'default import of a ROM module');
eq(utilNamespace.inspect, util.inspect, 'namespace import of a ROM module');
eq(utilNamespace.format('%s', 'x'), 'x');
eq(nodeUtil, util, 'node: prefix');
eq(format('%d-%s', 1, 'a'), '1-a', 'named import of a ROM module');
eq(readline, require('readline'));
eq(createInterface, readline.createInterface);
eq(con, console);
eq(proc, process);
eq(procNamespace.cwd(), process.cwd());
eq((procNamespace as unknown as { default: unknown }).default, process);

// A compiled module with a default export is flagged __esModule (not enumerable), so its default import is
// exports.default.
eq(greet('x'), 'hi x');
eq(answer, 42);
eq(lib.default, greet);
let plain = require('./interop-lib') as Record<string, unknown>;
eq(plain.default, greet, 'require() sees exports.default');
eq(plain.__esModule, true);
eq(Object.keys(plain).sort().join(), 'answer,counter,default,increment');
// Named imports are live bindings.
eq(counter, 0);
increment();
eq(counter, 1, 'live binding');

// async functions (Babel's asyncToGenerator with the engine's helpers) and promises from imported modules.
async function delayed(value: number): Promise<number> {
    await setTimeoutPromise(1);
    let doubled = await Promise.resolve(value * 2);
    return doubled + 1;
}
eq(asyncMod.unwrap(delayed(20)), 41, 'async function');

const arrow = async (): Promise<string> => {
    let parts: string[] = [];
    async function* source(): AsyncGenerator<string> {
        yield 'a';
        yield await Promise.resolve('b');
    }
    for await (const part of source()) parts.push(part);
    return parts.join();
};
eq(asyncMod.unwrap(arrow()), 'a,b', 'async generator and for await');
