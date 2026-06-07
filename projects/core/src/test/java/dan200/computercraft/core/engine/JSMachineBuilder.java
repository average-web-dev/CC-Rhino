// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.computer.TimeoutState;
import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.metrics.MetricsObserver;
import org.jspecify.annotations.Nullable;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Test helper for constructing {@link JSMachine}s with custom bios source, native APIs, a filesystem, a
 * {@link IContext} (for main-thread tasks) and a {@link TimeoutState}.
 *
 * <p>APIs are registered by name with a fixed set of {@link ApiMethod}s; the generated {@link MethodSupplier}
 * looks methods up per-object so each registered API exposes only its own methods.
 */
final class JSMachineBuilder {
    /** A timeout that never aborts — execution runs to completion. */
    static final TimeoutState NO_TIMEOUT = new TimeoutState() {
        @Override
        public void refresh() {
        }
    };

    /** A context that refuses main-thread tasks — use {@link #context} for blocking-API tests. */
    static final IContext NO_CONTEXT = task -> {
        throw new UnsupportedOperationException();
    };

    private String bios = "";
    private TimeoutState timeout = NO_TIMEOUT;
    private IContext context = NO_CONTEXT;
    private @Nullable FileSystem fileSystem;
    private final List<IComputerAPI> apis = new ArrayList<>();
    private final Map<Object, Map<String, ApiMethod>> methods = new HashMap<>();

    JSMachineBuilder bios(String js) {
        this.bios = js;
        return this;
    }

    JSMachineBuilder timeout(TimeoutState timeout) {
        this.timeout = timeout;
        return this;
    }

    JSMachineBuilder context(IContext context) {
        this.context = context;
        return this;
    }

    JSMachineBuilder fileSystem(FileSystem fileSystem) {
        this.fileSystem = fileSystem;
        return this;
    }

    /** Register a native module with the given name and methods. */
    JSMachineBuilder api(String name, Map<String, ApiMethod> apiMethods) {
        return api(new IComputerAPI() {
            @Override
            public String[] getNames() {
                return new String[]{ name };
            }
        }, apiMethods);
    }

    /** Register an explicit {@link IComputerAPI} with the given methods (e.g. a {@link Recorder}). */
    JSMachineBuilder api(IComputerAPI api, Map<String, ApiMethod> apiMethods) {
        apis.add(api);
        methods.put(api, apiMethods);
        return this;
    }

    JSMachine build() throws IOException {
        MethodSupplier<ApiMethod> supplier = new MethodSupplier<>() {
            @Override
            public boolean forEachSelfMethod(Object object, UntargetedConsumer<ApiMethod> consumer) {
                var m = methods.get(object);
                if (m == null || m.isEmpty()) return false;
                m.forEach((name, method) -> consumer.accept(name, method, null));
                return true;
            }

            @Override
            public boolean forEachMethod(Object object, TargetedConsumer<ApiMethod> consumer) {
                var m = methods.get(object);
                if (m == null || m.isEmpty()) return false;
                m.forEach((name, method) -> consumer.accept(object, name, method, null));
                return true;
            }
        };

        var env = new MachineEnvironment(
            context, MetricsObserver.discard(), timeout, apis, supplier, "test", fileSystem, () -> {});
        var stream = new ByteArrayInputStream(bios.getBytes(StandardCharsets.UTF_8));
        return new JSMachine(env, stream);
    }

    /**
     * A native module named {@code probe} exposing {@code record(value)}, which appends each call's first argument
     * to {@link #values}. Lets tests observe JS-side execution order and results without touching the private scope.
     */
    static final class Recorder implements IComputerAPI {
        final List<Object> values = Collections.synchronizedList(new ArrayList<>());

        @Override
        public String[] getNames() {
            return new String[]{ "probe" };
        }

        Map<String, ApiMethod> methods() {
            return Map.of("record", (target, context, args) -> {
                values.add(args.get(0));
                return MethodResult.of();
            });
        }
    }
}
