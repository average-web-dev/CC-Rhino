// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.methods.NamedMethod;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

import java.util.LinkedHashMap;

/** Builds a Rhino {@link Scriptable} object exposing all {@link ApiMethod}s of a CC API object. */
final class JSAPIBuilder {
    private static final String SYNC_SUFFIX = "Sync";

    private JSAPIBuilder() {}

    private record Entry(Object target, ApiMethod method, @Nullable NamedMethod<ApiMethod> info) {}

    /**
     * Enumerate every method on {@code api} via {@code methods} and wrap each as a {@link JSMethodBridge}.
     *
     * <p>An {@link IComputerAPI}'s {@linkplain IComputerAPI#getConstants() constants} become plain data properties.
     *
     * @param module   The module's name, e.g. {@code turtle}.
     * @param promises Whether to build the {@code <module>/promises} flavour (see {@link #addMethods}).
     * @return A plain JS object whose properties are the wrapped methods.
     */
    static Scriptable build(
        Context cx, Scriptable scope, JSCallShim shim, Object api, IContext context, MethodSupplier<ApiMethod> methods,
        String module, boolean promises
    ) {
        var obj = cx.newObject(scope);
        addMethods(cx, scope, shim, obj, api, context, methods, module, promises);
        if (api instanceof IComputerAPI computerApi) {
            for (var constant : computerApi.getConstants().entrySet()) {
                ScriptableObject.putProperty(obj, constant.getKey(), JSValues.toJs(cx, scope, constant.getValue()));
            }
        }
        return obj;
    }

    /**
     * Add the script methods of {@code java} to {@code obj}.
     *
     * <p>Blocking methods are put behind a {@link JSCallShim}, so that blocking calls which fail throw at their call
     * site. In the promise flavour every method returns a promise instead, and Node-style pairs collapse as in Node's
     * {@code fs/promises}: a {@code fooSync} with a callback-taking sibling {@code foo} becomes a promise-returning
     * {@code foo} (with {@code fooSync}'s signature), and neither original name is exposed.
     *
     * @param module The module the object belongs to (used in error messages), or {@code null} for an object returned
     *               by a method.
     * @return Whether {@code java} had any script methods.
     */
    static boolean addMethods(
        Context cx, Scriptable scope, JSCallShim shim, Scriptable obj, Object java, IContext context,
        MethodSupplier<ApiMethod> methods, @Nullable String module, boolean promises
    ) {
        var entries = new LinkedHashMap<String, Entry>();
        var found = methods.forEachMethod(java, (target, name, method, info) -> entries.put(name, new Entry(target, method, info)));

        var hint = module != null
            ? "require('" + module + "/promises')"
            : "the /promises module the object came from";
        for (var e : entries.entrySet()) {
            var name = e.getKey();
            var entry = e.getValue();
            if (promises) {
                if (entries.containsKey(name + SYNC_SUFFIX)) continue;
                if (name.endsWith(SYNC_SUFFIX) && name.length() > SYNC_SUFFIX.length()) {
                    var base = name.substring(0, name.length() - SYNC_SUFFIX.length());
                    if (entries.containsKey(base)) name = base;
                }
            }

            var mayBlock = entry.info() != null && !entry.info().nonYielding();
            var bridge = new JSMethodBridge(
                entry.method(), entry.target(), context, module == null ? name : module + "." + name, hint, mayBlock, promises
            );
            Object fn;
            if (promises) {
                ScriptRuntime.setFunctionProtoAndParent(bridge, cx, scope);
                fn = bridge;
            } else {
                fn = shim.wrap(cx, scope, bridge);
            }
            ScriptableObject.putProperty(obj, name, fn);
        }
        return found;
    }
}
