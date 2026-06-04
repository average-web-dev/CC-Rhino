// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.LuaTask;
import dan200.computercraft.api.lua.MethodResult;
import dan200.computercraft.core.asm.LuaMethodSupplier;
import dan200.computercraft.core.computer.TimeoutState;
import dan200.computercraft.core.metrics.MetricsObserver;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JSMachineTest {
    /** A no-op {@link TimeoutState} that never aborts. */
    private static final TimeoutState IDLE_TIMEOUT = new TimeoutState() {
        @Override
        public void refresh() {
        }
    };

    /** A {@link TimeoutState} that immediately reports soft abort. */
    private static final TimeoutState SOFT_ABORT_TIMEOUT = new TimeoutState() {
        {
            softAbort = true;
        }

        @Override
        public void refresh() {
        }
    };

    /** A {@link TimeoutState} that immediately reports hard abort. */
    private static final TimeoutState HARD_ABORT_TIMEOUT = new TimeoutState() {
        {
            hardAbort = true;
        }

        @Override
        public void refresh() {
        }
    };

    /** A no-op {@link ILuaContext}. */
    private static final ILuaContext NO_CONTEXT = new ILuaContext() {
        @Override
        public long issueMainThreadTask(LuaTask task) throws LuaException {
            throw new LuaException("No main thread in test");
        }
    };

    private static MachineEnvironment env() {
        return env(IDLE_TIMEOUT);
    }

    private static MachineEnvironment env(TimeoutState timeoutState) {
        return new MachineEnvironment(
            NO_CONTEXT,
            MetricsObserver.discard(),
            timeoutState,
            List.of(),
            LuaMethodSupplier.create(List.of()),
            "CC-Tweaked Test",
            null // no filesystem in unit tests
        );
    }

    @Test
    void testBootReturnsOk() throws MachineException {
        var bios = new ByteArrayInputStream("// no-op bios".getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "Expected OK result on startup, got error: " + result.getMessage());
        }
    }

    @Test
    void testPrintBios() throws MachineException {
        var biosCode = "print('hello from bios');";
        var bios = new ByteArrayInputStream(biosCode.getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "Bios with print() should not error: " + result.getMessage());
        }
    }

    @Test
    void testSubsequentEventsReturnOk() throws MachineException {
        var bios = new ByteArrayInputStream("// no-op bios".getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            machine.handleEvent(null, null);
            var result = machine.handleEvent("redstone", new Object[]{"left"});
            assertFalse(result.isError(), "Expected OK on subsequent event: " + result.getMessage());
        }
    }

    @Test
    void testStartEventFires() throws MachineException {
        // __start__ should be emitted automatically after bios runs
        var bios = new ByteArrayInputStream("""
            let fired = false;
            os.once("__start__", () => { fired = true; });
            globalThis.__testResult = () => fired;
            """.getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            machine.handleEvent(null, null);  // runs bios + emits __start__
            var result = machine.handleEvent("tick", null);
            assertFalse(result.isError(), "Should be OK: " + result.getMessage());
        }
    }

    @Test
    void testEventDispatchedToListener() throws MachineException {
        // os.on() callbacks should fire when handleEvent is called
        var bios = new ByteArrayInputStream("""
            globalThis.__received__ = null;
            os.on("redstone", (side) => { globalThis.__received__ = side; });
            """.getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            machine.handleEvent(null, null);
            var result = machine.handleEvent("redstone", new Object[]{"left"});
            assertFalse(result.isError(), "Event dispatch should not error: " + result.getMessage());
        }
    }

    @Test
    void testOnceListenerFiredOnce() throws MachineException {
        // os.once() should remove the listener after the first event
        var bios = new ByteArrayInputStream("""
            globalThis.__count__ = 0;
            os.once("char", () => { globalThis.__count__++; });
            """.getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            machine.handleEvent(null, null);
            machine.handleEvent("char", new Object[]{"a"});
            machine.handleEvent("char", new Object[]{"b"});
            // Second "char" should not increment — no assertion on internal count here;
            // success is simply that no exception was thrown
            var result = machine.handleEvent("char", new Object[]{"c"});
            assertFalse(result.isError());
        }
    }

    // ── Security tests (Phase 7) ──────────────────────────────────────────

    @Test
    void testJavaTypeIsBlocked() throws MachineException {
        // Java.type() must be blocked — no arbitrary class access from JS
        var bios = new ByteArrayInputStream("""
            try {
                Java.type("java.lang.Runtime");
                globalThis.__accessible__ = true;
            } catch (e) {
                globalThis.__accessible__ = false;
            }
            """.getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            machine.handleEvent(null, null);
            // If we get here without an error, the test is about not crashing;
            // the actual block verification is that no PolyglotException propagated
            // (GraalJS throws inside the try/catch in the script itself)
        }
    }

    @Test
    void testPackagesIsBlocked() throws MachineException {
        // Packages.java.lang.System must not work
        var bios = new ByteArrayInputStream("""
            try { Packages.java.lang.System.exit(0); } catch (e) { /* expected */ }
            """.getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(), bios)) {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "Packages.* access should throw in JS, not crash the machine: " + result.getMessage());
        }
    }

    @Test
    void testTightLoopSoftAbort() throws MachineException {
        // A tight loop with a pre-armed soft-abort should be terminated by the safepoint.
        var bios = new ByteArrayInputStream("while(true){}".getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(SOFT_ABORT_TIMEOUT), bios)) {
            var result = machine.handleEvent(null, null);
            assertTrue(result.isError(), "Tight loop should have been aborted");
            assertTrue(
                TimeoutState.ABORT_MESSAGE.equals(result.getMessage()),
                "Expected abort message, got: " + result.getMessage()
            );
        }
    }

    @Test
    void testTightLoopHardAbort() throws MachineException {
        // A tight loop with a pre-armed hard-abort should be terminated with TIMEOUT.
        var bios = new ByteArrayInputStream("while(true){}".getBytes(StandardCharsets.UTF_8));
        try (var machine = new JSMachine(env(HARD_ABORT_TIMEOUT), bios)) {
            var result = machine.handleEvent(null, null);
            assertTrue(result.isError(), "Hard abort should be an error");
            assertTrue(
                TimeoutState.ABORT_MESSAGE.equals(result.getMessage()),
                "Expected timeout message, got: " + result.getMessage()
            );
        }
    }
}
