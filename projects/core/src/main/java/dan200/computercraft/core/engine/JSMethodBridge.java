// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.methods.ApiMethod;
import org.mozilla.javascript.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Wraps a single {@link ApiMethod} as a Rhino {@link BaseFunction}.
 *
 * <p>If the method returns a {@link dan200.computercraft.api.scripting.MethodResult} with a callback (i.e. it wants to
 * yield until an event arrives), we capture a Rhino continuation and attach the MethodResult as application state.
 * The continuation is stored by {@link JSMachine#handleEvent} and resumed when the matching event fires.
 */
@SuppressWarnings("serial") // BaseFunction is Serializable but our fields aren't — serialization is never used here
final class JSMethodBridge extends BaseFunction {
    private static final long serialVersionUID = 1L;
    private static final Logger LOG = LoggerFactory.getLogger(JSMethodBridge.class);

    /** Message of the JS {@code Error} thrown when a native method fails unexpectedly (i.e. not a ScriptException). */
    static final String INTERNAL_ERROR_MESSAGE = "Internal error in native method";

    private final ApiMethod method;
    private final Object target;
    private final IContext context;

    JSMethodBridge(ApiMethod method, Object target, IContext context) {
        this.method = method;
        this.target = target;
        this.context = context;
    }

    @Override
    public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
        try {
            var mr = method.apply(target, context, new JSArguments(args));
            if (mr.getDestination() == null) {
                return JSValues.toJsResult(cx, scope, mr.getResult());
            }
            // Method wants to yield — capture a Rhino continuation so JS execution suspends.
            // handleEvent() will catch the thrown ContinuationPending and resume it later.
            var pending = cx.captureContinuation();
            pending.setApplicationState(mr);
            throw pending;
        } catch (ContinuationPending | RhinoException e) {
            // Continuations, aborts and JS errors raised by callbacks pass through unchanged.
            throw e;
        } catch (ScriptException e) {
            // An intentional API error: surface it as a plain JS Error carrying the message (and any extra properties).
            var error = jsError(cx, scope, e.getMessage() != null ? e.getMessage() : "Unknown error");
            if (error.getValue() instanceof Scriptable errorObj) JSErrors.putProperties(cx, scope, errorObj, e);
            throw error;
        } catch (Exception e) {
            // A bug in the native method. Log the details, but don't leak Java class names or messages to scripts.
            LOG.error("Unexpected exception in native method", e);
            throw jsError(cx, scope, INTERNAL_ERROR_MESSAGE);
        }
    }

    private static JavaScriptException jsError(Context cx, Scriptable scope, String message) {
        return ScriptRuntime.throwError(cx, ScriptableObject.getTopLevelScope(scope), message);
    }
}
