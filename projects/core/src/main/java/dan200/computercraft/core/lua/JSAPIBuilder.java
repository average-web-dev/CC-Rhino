// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.core.methods.LuaMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/** Builds a Rhino {@link Scriptable} object exposing all {@link LuaMethod}s of a CC API object. */
final class JSAPIBuilder {
    private JSAPIBuilder() {}

    /**
     * Enumerate every method on {@code api} via {@code methods} and wrap each as a {@link JSMethodBridge}.
     *
     * @return A plain JS object whose properties are the wrapped methods.
     */
    static Scriptable build(Context cx, Scriptable scope, Object api, ILuaContext context, MethodSupplier<LuaMethod> methods) {
        var obj = cx.newObject(scope);
        methods.forEachMethod(api, (target, name, method, info) ->
            ScriptableObject.putProperty(obj, name, new JSMethodBridge(method, target, context)));
        return obj;
    }
}
