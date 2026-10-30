// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// What plain-JS `require()` sees of every ROM module (#49): the ROM is written with ES module syntax and compiled by
// Babel, but a module's exports must look exactly as they did when it was a CommonJS `export =` object — the same
// keys, no `__esModule` flag, and `require('console') === console`, `require('process') === process`.
//
// The key sets were recorded from the ROM before the switch. Only the internal single-function modules changed on
// purpose: /rom/lib/resolve, /rom/lib/internal/callable and /rom/lib/internal/emitter now export their function
// or class by name.

import * as prelude from './prelude';

const eq = prelude.eq;

// The programs need `env` (bash) from /rom/lib, which the test bios does not put on require.paths.
if (require.paths.indexOf('/rom/lib') < 0) require.paths.push('/rom/lib');

const main = ['main'];
const expected: Record<string, [string, string[]]> = {
    'util': ['object', ['format', 'formatWithOptions', 'inherits', 'inspect', 'isDeepStrictEqual', 'promisify',
        'stripVTControlCharacters', 'styleText']],
    'console': ['object', ['assert', 'clear', 'count', 'countReset', 'debug', 'dir', 'dirxml', 'error', 'group',
        'groupCollapsed', 'groupEnd', 'info', 'log', 'table', 'time', 'timeEnd', 'timeLog', 'trace', 'warn']],
    'process': ['object', ['argv', 'argv0', 'chdir', 'cwd', 'emitWarning', 'env', 'execArgv', 'exit', 'exitCode',
        'hrtime', 'nextTick', 'platform', 'stderr', 'stdin', 'stdout', 'uptime']],
    'readline': ['object', ['Interface', 'clearLine', 'clearScreenDown', 'createInterface', 'cursorTo',
        'emitKeypressEvents', 'moveCursor', 'promises']],
    'readline/promises': ['object', ['Interface', 'createInterface']],
    'timers': ['object', ['clearImmediate', 'clearInterval', 'clearTimeout', 'promises', 'setImmediate', 'setInterval',
        'setTimeout']],
    'timers/promises': ['object', ['scheduler', 'setImmediate', 'setInterval', 'setTimeout']],
    '/rom/lib/env': ['object', ['all', 'get', 'has', 'set', 'unset']],
    '/rom/lib/resolve': ['object', ['resolve']],
    '/rom/lib/internal/callable': ['object', ['callable']],
    '/rom/lib/internal/emitter': ['object', ['EventEmitter']],
    '/rom/lib/internal/tty': ['object', ['CSI', 'beginJob', 'cursorColumn', 'endJob', 'exitCodeOf', 'jobId',
        'requestExit', 'stderr', 'stdin', 'stdout', 'terminal', 'waitForJob']],
    '/rom/lib/internal/keys': ['object', ['decodeKeys', 'mouseReportAt', 'stripMouse']],
    'tty': ['object', ['CSI', 'ReadStream', 'TTY', 'WriteStream', 'colourIndex', 'isatty']],
    'term': ['object', ['Term']],
    '/rom/lib/internal/globals': ['object', []],
    '/rom/bin/bash': ['object', ['getCwd', 'getExitCode', 'run', 'setCwd', 'start']],
    '/rom/bin/edit': ['object', main],
    '/rom/os/bin/cat': ['object', main],
    '/rom/os/bin/clear': ['object', main],
    '/rom/os/bin/cp': ['object', main],
    '/rom/os/bin/echo': ['object', main],
    '/rom/os/bin/ls': ['object', main],
    '/rom/os/bin/mkdir': ['object', main],
    '/rom/os/bin/mv': ['object', main],
    '/rom/os/bin/peripherals': ['object', main],
    '/rom/os/bin/rm': ['object', main],
};

for (const [name, [type, keys]] of Object.entries(expected)) {
    let m = require(name) as Record<string, unknown>;
    eq(typeof m, type, name + ': type');
    eq(Object.keys(m).sort().join(), keys.join(), name + ': keys');
    eq(Object.prototype.hasOwnProperty.call(m, '__esModule'), false, name + ': no __esModule flag');
    for (const key of keys) {
        // Everything is set, except the values that are undefined by design.
        if (!(name === 'process' && key === 'exitCode')) eq(m[key] !== undefined, true, name + '.' + key + ' is set');
    }
}

// Modules whose value is an object of their own, as in Node.
eq(require('console'), console);
eq(require('process'), process);
// Lazily loaded members.
eq((require('readline') as ReadlineModule).promises, require('readline/promises'));
eq((require('timers') as TimersModule).promises, require('timers/promises'));
