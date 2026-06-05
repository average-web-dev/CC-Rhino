// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.core.methods.LuaMethod;
import org.mozilla.javascript.*;

/**
 * Wraps a single {@link LuaMethod} as a Rhino {@link BaseFunction}.
 *
 * <p>If the method returns a {@link dan200.computercraft.api.lua.MethodResult} with a callback (i.e. it wants to
 * yield until an event arrives), we capture a Rhino continuation and attach the MethodResult as application state.
 * The continuation is stored by {@link JSMachine#handleEvent} and resumed when the matching event fires.
 */
@SuppressWarnings("serial") // BaseFunction is Serializable but our fields aren't — serialization is never used here
final class JSMethodBridge extends BaseFunction {
    private static final long serialVersionUID = 1L;

    private final LuaMethod method;
    private final Object target;
    private final ILuaContext context;

    JSMethodBridge(LuaMethod method, Object target, ILuaContext context) {
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
        } catch (LuaException e) {
            throw Context.throwAsScriptRuntimeEx(e);
        } catch (Exception e) {
            throw Context.throwAsScriptRuntimeEx(e);
        }
    }
}
