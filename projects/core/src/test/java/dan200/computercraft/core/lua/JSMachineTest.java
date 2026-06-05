// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.core.computer.TimeoutState;
import dan200.computercraft.core.methods.LuaMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.methods.NamedMethod;
import dan200.computercraft.core.metrics.MetricsObserver;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;


class JSMachineTest {
    private static final TimeoutState NO_TIMEOUT = new TimeoutState() {
        @Override
        public void refresh() {
        }
    };

    private static final ILuaContext NO_CONTEXT = task -> { throw new UnsupportedOperationException(); };

    private static final MethodSupplier<LuaMethod> NO_METHODS = new MethodSupplier<>() {
        @Override
        public boolean forEachSelfMethod(Object object, UntargetedConsumer<LuaMethod> consumer) {
            return false;
        }

        @Override
        public boolean forEachMethod(Object object, TargetedConsumer<LuaMethod> consumer) {
            return false;
        }
    };

    private static JSMachine machineWith(String js) throws Exception {
        InputStream bios = new ByteArrayInputStream(js.getBytes(StandardCharsets.UTF_8));
        var env = new MachineEnvironment(NO_CONTEXT, MetricsObserver.discard(), NO_TIMEOUT, List.of(), NO_METHODS, "test", null);
        return new JSMachine(env, bios);
    }

    @Test
    void boot_returns_ok() throws Exception {
        var machine = machineWith("/* empty bios */");
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "boot should succeed");
        } finally {
            machine.close();
        }
    }

    @Test
    void script_evaluates_successfully() throws Exception {
        var machine = machineWith("var x = 1 + 1;");
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "simple script should evaluate without error");
        } finally {
            machine.close();
        }
    }

    @Test
    void subsequent_events_return_ok() throws Exception {
        var machine = machineWith("/* empty bios */");
        try {
            machine.handleEvent(null, null);
            var result = machine.handleEvent("redstone", new Object[0]);
            assertFalse(result.isError(), "subsequent events should return OK");
        } finally {
            machine.close();
        }
    }

    @Test
    void hard_abort_returns_timeout() throws Exception {
        // Arm hard abort before boot so the first instruction check fires it.
        var timeout = new TimeoutState() {
            @Override public void refresh() {}
            { hardAbort = true; }
        };

        InputStream bios = new ByteArrayInputStream("while(true){}".getBytes(StandardCharsets.UTF_8));
        var env = new MachineEnvironment(NO_CONTEXT, MetricsObserver.discard(), timeout, List.of(), NO_METHODS, "test", null);
        var machine = new JSMachine(env, bios);
        try {
            var result = machine.handleEvent(null, null);
            assertTrue(result.isError(), "hard abort should be an error");
            assertEquals(MachineResult.TIMEOUT, result);
        } finally {
            machine.close();
        }
    }

    @Test
    void soft_abort_returns_too_long() throws Exception {
        var timeout = new TimeoutState() {
            @Override public void refresh() {}
            { softAbort = true; }
        };

        var bios2 = new ByteArrayInputStream("while(true){}".getBytes(StandardCharsets.UTF_8));
        var env2 = new MachineEnvironment(NO_CONTEXT, MetricsObserver.discard(), timeout, List.of(), NO_METHODS, "test", null);
        var machine2 = new JSMachine(env2, bios2);
        try {
            var result = machine2.handleEvent(null, null);
            assertTrue(result.isError(), "soft abort should be an error");
            assertEquals(TimeoutState.ABORT_MESSAGE, result.getMessage());
        } finally {
            machine2.close();
        }
    }

    @Test
    void require_is_accessible_as_global() throws Exception {
        var machine = machineWith("if (typeof require !== 'function') throw new Error('require not found');");
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "require should be a global function");
        } finally {
            machine.close();
        }
    }

    @Test
    void require_missing_module_produces_error() throws Exception {
        // No filesystem — any require call should fail with MODULE_NOT_FOUND
        var machine = machineWith("require('missing');");
        try {
            var result = machine.handleEvent(null, null);
            assertTrue(result.isError(), "missing module should cause an error");
            assertTrue(result.getMessage().contains("MODULE_NOT_FOUND"), "error should mention MODULE_NOT_FOUND");
        } finally {
            machine.close();
        }
    }

}
