// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/globals.ts — install the Node-style globals: `process`, `console`, the timer functions
// (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `setImmediate`, `clearImmediate`, see /rom/lib/timers)
// and `queueMicrotask`.
//
// Required by the bios (and the test bioses) as the very first thing: loading `process` registers the terminal
// driver's input listeners (internal/tty), which must belong to the root thread and run before any other listener.
// Like in Node, the globals are writable, configurable and not enumerable; `require('process')`,
// `require('console')` and `require('timers')` return the same objects.

import proc from 'process';
import con from 'console';
import * as timers from '/rom/lib/timers';
import events from 'events';

function define(name: string, value: unknown): void {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}

define('process', proc);
define('console', con);
define('setTimeout', timers.setTimeout);
define('clearTimeout', timers.clearTimeout);
define('setInterval', timers.setInterval);
define('clearInterval', timers.clearInterval);
define('setImmediate', timers.setImmediate);
define('clearImmediate', timers.clearImmediate);
define('queueMicrotask', function queueMicrotask(callback: () => void): void {
    if (typeof callback !== 'function') {
        let err = new TypeError('The "callback" argument must be of type function');
        (err as any).code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    // A plain function: the engine enters it with continuations (a native callback such as a promise's resolve
    // function could not be).
    events.queueMicrotask(function () { callback(); });
});
