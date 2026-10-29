// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Helpers for the stdio library tests (StdioLibraryTest), which mounts this module as /prelude.js next to the test
// program (/test.js). Run by ComputerBootstrap's test bios, which installs the `process` and `console` globals and
// provides `assert(value, message)`.

const { EventEmitter } = require('/rom/lib/internal/emitter');

/** A writable stream collecting everything written to it. */
interface Sink extends Writable {
    out: string;
    readonly isTTY: boolean;
    readonly columns: number | undefined;
    on(): Sink;
    removeListener(): Sink;
}

/** A readable terminal-like source: emit('data', text) feeds it. */
interface Source extends InternalEventEmitter {
    isTTY: boolean;
    isRaw: boolean;
    paused: boolean;
    setRawMode(mode: boolean): Source;
    pause(): Source;
    resume(): Source;
}

/** An error thrown by the ROM libraries: Node-style errors carry a `code`. */
interface CodedError extends Error {
    code?: string;
}

function show(value: unknown): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function eq(actual: unknown, expected: unknown, message?: string): void {
    assert(actual === expected, (message ? message + ': ' : '') + 'expected ' + show(expected) + ', got ' + show(actual));
}

function matches(actual: unknown, pattern: RegExp, message?: string): void {
    assert(typeof actual === 'string' && pattern.test(actual),
        (message ? message + ': ' : '') + show(actual) + ' does not match ' + pattern);
}

function throws(fn: () => void, code?: string, message?: string): CodedError {
    try {
        fn();
    } catch (e) {
        let error = e as CodedError;
        if (code !== undefined) eq(error.code, code, message);
        return error;
    }
    assert(false, (message ? message + ': ' : '') + 'expected an error');
}

function sink(columns?: number): Sink {
    let s: Sink = {
        out: '',
        isTTY: columns !== undefined,
        columns: columns,
        write: function (chunk) { s.out += chunk; return true; },
        on: function () { return s; },
        removeListener: function () { return s; },
    };
    return s;
}

function source(): Source {
    let e = new EventEmitter() as Source;
    e.isTTY = true;
    e.isRaw = false;
    e.paused = false;
    e.setRawMode = function (mode) { e.isRaw = mode; return e; };
    e.pause = function () { e.paused = true; return e; };
    e.resume = function () { e.paused = false; return e; };
    return e;
}

export { eq, matches, throws, sink, source };
