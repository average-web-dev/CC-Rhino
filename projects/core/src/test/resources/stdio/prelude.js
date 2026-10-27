// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Helpers for the stdio library tests (StdioLibraryTest): run by ComputerBootstrap's test bios, which installs the
// `process` and `console` globals and provides `assert(value, message)`.

var EventEmitter = require('/rom/lib/internal/emitter');
var events = require('events');
var asyncMod = require('async');

function show(value) {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function eq(actual, expected, message) {
    assert(actual === expected, (message ? message + ': ' : '') + 'expected ' + show(expected) + ', got ' + show(actual));
}

function matches(actual, pattern, message) {
    assert(typeof actual === 'string' && pattern.test(actual),
        (message ? message + ': ' : '') + show(actual) + ' does not match ' + pattern);
}

function throws(fn, code, message) {
    try {
        fn();
    } catch (e) {
        if (code !== undefined) eq(e.code, code, message);
        return e;
    }
    assert(false, (message ? message + ': ' : '') + 'expected an error');
}

/** A writable stream collecting everything written to it. */
function sink(columns) {
    var s = {
        out: '',
        isTTY: columns !== undefined,
        columns: columns,
        write: function (chunk) { s.out += chunk; return true; },
        on: function () { return s; },
        removeListener: function () { return s; },
    };
    return s;
}

/** A readable terminal-like source: emit('data', text) feeds it. */
function source() {
    var e = new EventEmitter();
    e.isTTY = true;
    e.isRaw = false;
    e.paused = false;
    e.setRawMode = function (mode) { e.isRaw = mode; return e; };
    e.pause = function () { e.paused = true; return e; };
    e.resume = function () { e.paused = false; return e; };
    return e;
}
