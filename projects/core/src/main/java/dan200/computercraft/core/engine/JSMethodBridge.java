// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.methods.ApiMethod;
import org.mozilla.javascript.*;

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
            if (mr.getCallback() == null) {
                return JSValues.toJsResult(cx, scope, mr.getResult());
            }
            // Method wants to yield — capture a Rhino continuation so JS execution suspends.
            // handleEvent() will catch the thrown ContinuationPending and resume it later.
            var pending = cx.captureContinuation();
            pending.setApplicationState(mr);
            throw pending;
        } catch (ContinuationPending e) {
            throw e;
        } catch (ScriptException e) {
            throw Context.throwAsScriptRuntimeEx(e);
        } catch (Exception e) {
            throw Context.throwAsScriptRuntimeEx(e);
        }
    }
}
