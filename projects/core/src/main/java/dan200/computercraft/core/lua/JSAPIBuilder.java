// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaAPI;
import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.core.methods.LuaMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import org.graalvm.polyglot.Value;
import org.graalvm.polyglot.proxy.ProxyObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Builds a GraalJS {@link ProxyObject} that exposes all {@link LuaMethod}-annotated methods of an
 * {@link ILuaAPI} as callable JS functions.
 */
final class JSAPIBuilder {
    private JSAPIBuilder() {}

    /**
     * Build a JS proxy object for the given API.
     *
     * @param api        The API whose methods to expose.
     * @param methods    Method supplier that discovers annotated methods via reflection.
     * @param luaContext The {@link ILuaContext} to pass to each method call.
     * @param machine    The owning {@link JSMachine} (needed for pending-callback storage).
     * @return A {@link Value} that acts as a JS object with one callable property per API method.
     */
    static Value build(ILuaAPI api, MethodSupplier<LuaMethod> methods, ILuaContext luaContext, JSMachine machine) {
        Map<String, Object> members = new LinkedHashMap<>();

        methods.forEachMethod(api, (target, name, method, info) ->
            members.put(name, new JSMethodBridge(method, target, luaContext, machine, name))
        );

        return machine.context().asValue(ProxyObject.fromMap(members));
    }
}
