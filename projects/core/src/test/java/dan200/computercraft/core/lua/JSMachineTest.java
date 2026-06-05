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

import static org.junit.jupiter.api.Assertions.assertFalse;

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
        var env = new MachineEnvironment(NO_CONTEXT, MetricsObserver.discard(), NO_TIMEOUT, List.of(), NO_METHODS, "test");
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
}
