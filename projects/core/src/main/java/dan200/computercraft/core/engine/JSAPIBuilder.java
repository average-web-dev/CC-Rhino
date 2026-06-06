// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/** Builds a Rhino {@link Scriptable} object exposing all {@link ApiMethod}s of a CC API object. */
final class JSAPIBuilder {
    private JSAPIBuilder() {}

    /**
     * Enumerate every method on {@code api} via {@code methods} and wrap each as a {@link JSMethodBridge}.
     *
     * @return A plain JS object whose properties are the wrapped methods.
     */
    static Scriptable build(Context cx, Scriptable scope, Object api, IContext context, MethodSupplier<ApiMethod> methods) {
        var obj = cx.newObject(scope);
        methods.forEachMethod(api, (target, name, method, info) ->
            ScriptableObject.putProperty(obj, name, new JSMethodBridge(method, target, context)));
        return obj;
    }
}
