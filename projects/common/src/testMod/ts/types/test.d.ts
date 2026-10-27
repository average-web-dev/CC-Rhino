// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The global `test` API of the gametest computers: the native `test` module (TestAPI.java) wrapped and extended with
// assertion helpers by the gametest bios (ManagedComputers.TEST_BIOS).

interface TestGlobal {
    /**
     * Report success, or with a `marker`, report that the program reached that point (the Kotlin side of the test
     * waits for it with `thenComputerOk(marker = …)`). Each marker can be reported once; `ok()` ends the test.
     */
    ok(marker?: string): void;
    /** Fail the test with `message`. Throws, so the program stops here. */
    fail(message: unknown): never;
    /** Write `message` to the server log. */
    log(message: unknown): void;
    /** Queue an event on this computer, as if it came from outside (for instance `terminate` from Ctrl+T). */
    queueEvent(event: string): void;
    /**
     * Run a turtle command whose `execute()` throws `message`, as a buggy addon command might. The call throws instead
     * of returning; throws "Not a turtle" on other computers.
     */
    runFaultyTurtleCommand(message: string): Result;
    /** Fail the test with `message` (default "Assertion failed") unless `value` is truthy. */
    assert(value: unknown, message?: string): asserts value;
    /** Fail the test unless `expected === actual`. */
    eq<T>(expected: T, actual: T, message?: string): void;
    /** Fail the test if `expected === actual`. */
    neq<T>(expected: T, actual: T, message?: string): void;
}

declare const test: TestGlobal;
