// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/globals.ts — install the Node-style globals `process` and `console`.
//
// Required by the bios (and the test bioses) as the very first thing: loading `process` registers the terminal
// driver's input listeners (internal/tty), which must belong to the root thread and run before any other listener.
// Like in Node, the globals are writable, configurable and not enumerable; `require('process')` and
// `require('console')` return the same objects.

import proc = require('/rom/lib/process');
import con = require('/rom/lib/console');

function define(name: string, value: unknown): void {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}

define('process', proc);
define('console', con);

export = {};
