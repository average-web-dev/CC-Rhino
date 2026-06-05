// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `peripheral` — interact with attached peripherals. `wrap()` returns a JS proxy object.

/** A wrapped peripheral: an object whose methods call into the peripheral. */
type WrappedPeripheral = Record<string, (...args: unknown[]) => unknown>;

interface PeripheralModule {
    getNames(): string[];
    isPresent(side: string): boolean;
    /** The peripheral's type(s), or `null` if nothing is attached. */
    getType(side: string): string[] | null;
    hasType(side: string, type: string): boolean | null;
    getMethods(side: string): string[] | null;

    /** Call a method by name. Returns the method's result (an array if it yields several values). */
    call(side: string, method: string, ...args: unknown[]): unknown;

    /** Wrap a peripheral into an object with callable methods, or `null` if absent. */
    wrap(side: string): WrappedPeripheral | null;
}
