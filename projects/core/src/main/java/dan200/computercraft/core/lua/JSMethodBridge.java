// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.MethodResult;
import dan200.computercraft.core.methods.LuaMethod;
import org.graalvm.polyglot.Value;
import org.graalvm.polyglot.proxy.ProxyExecutable;
import org.jspecify.annotations.Nullable;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.Consumer;

/**
 * Wraps a {@link LuaMethod} as a GraalJS {@link ProxyExecutable}.
 * <p>
 * Handles the two {@link MethodResult} cases:
 * <ul>
 *   <li>No callback — converts results to JS values and returns synchronously.</li>
 *   <li>Has callback ({@code pullEvent} pattern) — creates a JS {@link Promise} and stores
 *       a {@link JSMachine.PendingCallback} in the machine so it can be resolved when the
 *       matching CC event arrives via {@link JSMachine#handleEvent}.</li>
 * </ul>
 */
final class JSMethodBridge implements ProxyExecutable {
    private static final Logger LOG = LoggerFactory.getLogger(JSMethodBridge.class);

    private final LuaMethod method;
    private final Object target;
    private final ILuaContext luaContext;
    private final JSMachine machine;
    private final String name;

    JSMethodBridge(LuaMethod method, Object target, ILuaContext luaContext, JSMachine machine, String name) {
        this.method = method;
        this.target = target;
        this.luaContext = luaContext;
        this.machine = machine;
        this.name = name;
    }

    @Override
    @SuppressWarnings("NullAway") // ProxyExecutable may return null for void-result methods
    public @NonNull Object execute(Value... jsArgs) {
        var args = new JSArguments(jsArgs);
        MethodResult result;
        try {
            result = method.apply(target, luaContext, args);
        } catch (LuaException e) {
            throw new RuntimeException(e.getMessage(), e);
        } catch (Throwable t) {
            LOG.error("Unexpected error calling JS API method '{}'", name, t);
            throw new RuntimeException("Java exception: " + t.getMessage(), t);
        }

        return interpretResult(result);
    }

    @Nullable Object interpretResult(MethodResult result) {
        if (result.getCallback() == null) {
            // Synchronous result — convert and return
            return JSValues.resultToJs(machine.context(), result.getResult());
        }

        // Async result: create a Promise, capture resolve/reject, store pending callback
        var resolveRef = new Value[1];
        var rejectRef  = new Value[1];
        var promise = machine.createPromiseFn().execute((ProxyExecutable) promiseArgs -> {
            resolveRef[0] = promiseArgs[0];
            rejectRef[0]  = promiseArgs[1];
            return null;
        });

        var filter   = extractFilter(result);
        var callback = result.getCallback();
        machine.setPendingCallback(new JSMachine.PendingCallback(filter, callback, resolveRef[0], rejectRef[0]));
        return promise;
    }

    /** Extracts the event-name filter from a pullEvent MethodResult (first element of the result array). */
    private static @Nullable String extractFilter(MethodResult result) {
        var vals = result.getResult();
        if (vals != null && vals.length > 0 && vals[0] instanceof String s) return s;
        return null;
    }
}
