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

import java.util.function.Supplier;

/**
 * Converts Java objects exposing script methods (e.g. {@code @ScriptFunction} methods, dynamic objects, file or HTTP
 * handles) into JS objects whose properties are the wrapped methods, so they can be returned from native methods and
 * passed as event arguments.
 *
 * <p>Objects returned through a {@code /promises} module (see {@link #forPromises}) get promise-returning methods, so
 * code using that module stays asynchronous all the way down, as with Node's {@code FileHandle}.
 *
 * <p>Installed on the machine's Rhino context by {@link JSMachine}, in the same way as {@link JSScheduler}.
 */
final class JSObjects {
    private static final Object KEY = JSObjects.class;

    private final JSCallShim shim;
    private final IContext context;
    private final MethodSupplier<ApiMethod> methods;
    private int promiseDepth = 0;

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
        var found = JSAPIBuilder.addMethods(
            cx, scope, objects.shim, obj, java, objects.context, objects.methods, null, objects.promiseDepth > 0
        );
        return found ? obj : null;
    }

    /** Run a conversion of a {@code /promises} call's result: objects it wraps get promise-returning methods. */
    static <T> T forPromises(Context cx, Supplier<T> convert) {
        var objects = (JSObjects) cx.getThreadLocal(KEY);
        if (objects == null) return convert.get();
        objects.promiseDepth++;
        try {
            return convert.get();
        } finally {
            objects.promiseDepth--;
        }
    }
}
