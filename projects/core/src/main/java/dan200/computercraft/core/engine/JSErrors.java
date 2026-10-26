// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.ScriptException;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/**
 * Converts {@link ScriptException}s into JS {@code Error} objects, including their
 * {@linkplain ScriptException#getProperties() extra properties} (e.g. Node-style {@code code} / {@code path}).
 */
public final class JSErrors {
    private JSErrors() {}

    /**
     * Create (but do not throw) a JS {@code Error} for {@code e}, e.g. to pass to an error-first callback.
     *
     * @param cx    The current Rhino context.
     * @param scope The scope to create the error in.
     * @param e     The exception to convert.
     * @return The new error object.
     */
    public static Scriptable newError(Context cx, Scriptable scope, ScriptException e) {
        var message = e.getMessage() != null ? e.getMessage() : "Unknown error";
        var error = cx.newObject(ScriptableObject.getTopLevelScope(scope), "Error", new Object[]{ message });
        putProperties(cx, scope, error, e);
        return error;
    }

    /** Copy the extra properties of {@code e} onto an existing error object. */
    static void putProperties(Context cx, Scriptable scope, Scriptable error, ScriptException e) {
        for (var property : e.getProperties().entrySet()) {
            ScriptableObject.putProperty(error, property.getKey(), JSValues.toJs(cx, scope, property.getValue()));
        }
    }
}
