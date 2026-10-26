// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/**
 * Converts Java objects exposing script methods (e.g. {@code @ScriptFunction} methods, dynamic objects, file or HTTP
 * handles) into JS objects whose properties are the wrapped methods, so they can be returned from native methods and
 * passed as event arguments.
 *
 * <p>Installed on the machine's Rhino context by {@link JSMachine}, in the same way as {@link JSScheduler}.
 */
final class JSObjects {
    private static final Object KEY = JSObjects.class;

    private final JSCallShim shim;
    private final IContext context;
    private final MethodSupplier<ApiMethod> methods;

    private JSObjects(JSCallShim shim, IContext context, MethodSupplier<ApiMethod> methods) {
        this.shim = shim;
        this.context = context;
        this.methods = methods;
    }

    static void install(Context cx, JSCallShim shim, IContext context, MethodSupplier<ApiMethod> methods) {
        cx.putThreadLocal(KEY, new JSObjects(shim, context, methods));
    }

    /**
     * Wrap a Java object as a JS object of its script methods.
     *
     * @return The JS object, or {@code null} if no wrapper is installed or the object has no script methods.
     */
    static @Nullable Scriptable wrap(Context cx, Scriptable scope, Object java) {
        var objects = (JSObjects) cx.getThreadLocal(KEY);
        if (objects == null) return null;

        var obj = cx.newObject(scope);
        var found = objects.methods.forEachMethod(java, (target, name, method, info) ->
            ScriptableObject.putProperty(obj, name, objects.shim.wrap(cx, scope, new JSMethodBridge(method, target, objects.context))));
        return found ? obj : null;
    }
}
