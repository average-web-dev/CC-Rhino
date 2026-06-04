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

class JSMachineTest {
    /** A no-op {@link TimeoutState} that never aborts. */
    private static final TimeoutState IDLE_TIMEOUT = new TimeoutState() {
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
        return new MachineEnvironment(
            NO_CONTEXT,
            MetricsObserver.discard(),
            IDLE_TIMEOUT,
            List.of(),
            LuaMethodSupplier.create(List.of()),
            "CC-Tweaked Test"
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
}
