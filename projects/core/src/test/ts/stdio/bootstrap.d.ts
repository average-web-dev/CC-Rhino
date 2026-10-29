// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Globals and modules available to programs run by ComputerBootstrap's test bios (the stdio library tests).

/**
 * Installed by ComputerBootstrap's test bios: forwards to the `assertion` test module, which fails the test with
 * `message` (default "Assertion failed") when `value` is false, and records that the test asserted something.
 */
declare function assert(value: boolean, message?: string): asserts value;

/** The ROM's internal EventEmitter (/rom/lib/internal/emitter.ts, not a public module), used to fake input streams. */
interface InternalEventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    listenerCount(event: string | symbol): number;
}

interface InternalEventEmitterConstructor {
    new(): InternalEventEmitter;
}

declare function require(id: "/rom/lib/internal/emitter"): { EventEmitter: InternalEventEmitterConstructor };
/** The ROM's env library, which backs `process.env` (also the native-looking `require("env")`). */
declare function require(id: "/rom/lib/env"): EnvModule;
