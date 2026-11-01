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
    'process': ['object', ['addListener', 'argv', 'argv0', 'chdir', 'cwd', 'emitWarning', 'env', 'execArgv', 'exit',
        'exitCode', 'hrtime', 'kill', 'listenerCount', 'nextTick', 'off', 'on', 'once', 'pid', 'platform', 'ppid',
        'removeListener', 'stderr', 'stdin', 'stdout', 'uptime']],
    'readline': ['object', ['Interface', 'clearLine', 'clearScreenDown', 'createInterface', 'cursorTo',
        'moveCursor', 'promises']],
    'readline/promises': ['object', ['Interface', 'createInterface']],
    'timers': ['object', ['clearImmediate', 'clearInterval', 'clearTimeout', 'promises', 'setImmediate', 'setInterval',
        'setTimeout']],
    'timers/promises': ['object', ['scheduler', 'setImmediate', 'setInterval', 'setTimeout']],
    '/rom/lib/env': ['object', ['all', 'get', 'has', 'set', 'unset']],
    '/rom/lib/resolve': ['object', ['resolve']],
    '/rom/lib/internal/callable': ['object', ['callable']],
    '/rom/lib/internal/emitter': ['object', ['EventEmitter']],
    '/rom/lib/internal/tty': ['object', ['CSI', 'Job', 'console', 'createJob', 'createVirtual', 'current',
        'cursorColumn', 'exitCodeOf', 'formatError', 'inUse', 'infoOf', 'kill', 'processOf', 'processes',
        'requestExit', 'root', 'run', 'signalName', 'signalOf', 'terminal', 'ttyOf']],
    '/rom/lib/internal/keys': ['object', ['InputType', 'Key', 'MouseAction', 'MouseButton', 'decodeFirst',
        'decodeInput', 'isModifierKey', 'mouseReportAt', 'stripMouse', 'toLegacy']],
    '/rom/lib/internal/csi': ['object', ['CSI']],
    'tty': ['object', ['CSI', 'InputType', 'Key', 'KeyboardFlag', 'MouseAction', 'MouseButton', 'ReadStream', 'TTY',
        'WriteStream', 'decodeInput', 'isatty']],
    'term': ['object', ['ColorIndex', 'InputType', 'Key', 'MouseAction', 'MouseButton', 'Term']],
    'child_process': ['object', ['ChildProcess', 'exec', 'execSync', 'spawn', 'spawnSync']],
    'os': ['object', ['run']],
    'geometry': ['object', ['Point', 'Vector']],
    'color': ['object', ['Color', 'Dye']],
    'system': ['object', ['Signal', 'cancelAlarm', 'cancelTimer', 'clock', 'computerID', 'computerLabel', 'day',
        'epoch', 'getComputerID', 'getComputerLabel', 'getHost', 'off', 'on', 'once', 'process', 'processes', 'reboot',
        'setAlarm', 'setComputerLabel', 'shutdown', 'sleep', 'startTimer', 'time', 'yield']],
    'system/promises': ['object', ['cancelAlarm', 'cancelTimer', 'clock', 'computerID', 'computerLabel', 'day',
        'epoch', 'getComputerID', 'getComputerLabel', 'getHost', 'process', 'processes', 'reboot', 'setAlarm',
        'setComputerLabel', 'shutdown', 'sleep', 'startTimer', 'time', 'yield']],
    'peripheral': ['object', ['call', 'find', 'get', 'getDeviceOn', 'getMethods', 'getNames', 'getType', 'hasType',
        'isPresent', 'list', 'off', 'on', 'once', 'wrap']],
    '/rom/lib/internal/devices': ['object', ['infoOf', 'start']],
    'peripheral/promises': ['object', ['call', 'get', 'getDeviceOn', 'getMethods', 'getNames', 'getType', 'hasType',
        'isPresent', 'list']],
    '/rom/lib/internal/globals': ['object', []],
    '/rom/bin/bash': ['object', ['getCwd', 'getExitCode', 'main', 'run', 'setCwd', 'start']],
    '/rom/bin/edit': ['object', main],
    '/rom/bin/vi': ['object', main],
    '/rom/bin/vim': ['object', main],
    '/rom/os/bin/about': ['object', main],
    '/rom/os/bin/cat': ['object', main],
    '/rom/os/bin/chvt': ['object', main],
    '/rom/os/bin/clear': ['object', main],
    '/rom/os/bin/cp': ['object', main],
    '/rom/os/bin/drive': ['object', main],
    '/rom/os/bin/echo': ['object', main],
    '/rom/os/bin/id': ['object', main],
    '/rom/os/bin/kill': ['object', main],
    '/rom/os/bin/label': ['object', main],
    '/rom/os/bin/ls': ['object', main],
    '/rom/os/bin/mkdir': ['object', main],
    '/rom/os/bin/monitor': ['object', main],
    '/rom/os/bin/mount': ['object', main],
    '/rom/os/bin/mv': ['object', main],
    '/rom/os/bin/peripherals': ['object', main],
    '/rom/os/bin/ps': ['object', main],
    '/rom/os/bin/programs': ['object', main],
    '/rom/os/bin/reboot': ['object', main],
    '/rom/os/bin/redstone': ['object', main],
    '/rom/os/bin/rm': ['object', main],
    '/rom/os/bin/shutdown': ['object', main],
    '/rom/os/bin/time': ['object', main],
    '/rom/os/bin/type': ['object', main],
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

// system and peripheral pass on every function of the native module behind them (#60, #61, #62).
for (const [name, nativeName] of [['system', 'internal/system'], ['system/promises', 'internal/system/promises'],
    ['peripheral', 'internal/peripheral'], ['peripheral/promises', 'internal/peripheral/promises']]) {
    let wrapper = require(name) as Record<string, unknown>;
    for (const key of Object.keys(require(nativeName) as object)) {
        // /dev is filled by the OS (internal/devices), not by programs.
        if (key === 'setDeviceFile' || key === 'removeDeviceFile') continue;
        eq(typeof wrapper[key], 'function', name + ' passes on ' + nativeName + '.' + key);
    }
}

// Modules whose value is an object of their own, as in Node.
eq(require('console'), console);
eq(require('process'), process);
// Lazily loaded members.
eq((require('readline') as ReadlineModule).promises, require('readline/promises'));
eq((require('timers') as TimersModule).promises, require('timers/promises'));
