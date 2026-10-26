// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.methods.ApiMethod;
import org.mozilla.javascript.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Wraps a single {@link ApiMethod} as a Rhino {@link BaseFunction}, in one of two flavours:
 *
 * <ul>
 *   <li><strong>Blocking</strong> (the default modules): if the method returns a {@link MethodResult} with a
 *   destination (i.e. it wants to wait for an event), we capture a Rhino continuation and attach the MethodResult as
 *   application state. The {@link EventLoop} parks the continuation and resumes it when the matching event fires.
 *   Inside async code (see {@link EventLoop#inAsyncCode()}) no continuation can be captured, so a method that may
 *   block throws a clear error pointing to the {@code /promises} module instead.</li>
 *   <li><strong>Promise</strong> ({@code <module>/promises}): the method never blocks the caller. It returns a promise,
 *   which the event loop settles once the operation completes — or straight away if it completed immediately.
 *   Failures reject with the same error the blocking form would throw.</li>
 * </ul>
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
    private final String name;
    private final String hint;
    private final boolean mayBlock;
    private final boolean promise;

    /**
     * @param method   The method to call.
     * @param target   The object to call it on.
     * @param context  The context to call it with.
     * @param name     The name used in errors, e.g. {@code turtle.dig}.
     * @param hint     What to use instead inside async code, e.g. {@code require('turtle/promises')}.
     * @param mayBlock Whether the method is known to possibly block (returns a {@link MethodResult} or runs on the
     *                 main thread). Such methods are rejected inside async code <em>before</em> they run, so they
     *                 have no side effects there. Methods of unknown kind are only rejected once they actually block.
     * @param promise  Whether this is the {@code /promises} flavour.
     */
    JSMethodBridge(
        ApiMethod method, Object target, IContext context, String name, String hint, boolean mayBlock, boolean promise
    ) {
        this.method = method;
        this.target = target;
        this.context = context;
        this.name = name;
        this.hint = hint;
        this.mayBlock = mayBlock;
        this.promise = promise;
    }

    @Override
    public String getFunctionName() {
        var dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.substring(dot + 1);
    }

    @Override
    public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
        return promise ? callPromise(cx, scope, args) : callBlocking(cx, scope, args);
    }

    private Object callBlocking(Context cx, Scriptable scope, Object[] args) {
        var promises = JSPromises.get(cx);
        var inAsyncCode = promises != null && promises.inAsyncCode();
        // A method that may block needs a continuation, so make sure we can capture one *before* it runs and has side
        // effects. Capturing only freezes the interpreter frames (they are copied on write afterwards); if the method
        // then returns immediately, the unused continuation is simply dropped. In async code we know it is impossible
        // without trying — and must not try, as capturing would freeze a generator's frame.
        ContinuationPending pending = null;
        if (mayBlock) {
            if (inAsyncCode) throw JSPromises.blockingError(cx, scope, name, hint, true);
            pending = capture(cx, scope);
        }
        try {
            var mr = method.apply(target, context, new JSArguments(args));
            if (mr.getDestination() == null) {
                return JSValues.toJsResult(cx, scope, mr.getResult());
            }
            // Method wants to yield — suspend JS execution with a Rhino continuation. The event loop catches the
            // thrown ContinuationPending and resumes it later. A method we expected not to block can only fail here.
            if (pending == null) {
                if (inAsyncCode) throw JSPromises.blockingError(cx, scope, name, hint, true);
                pending = capture(cx, scope);
            }
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

    private Object callPromise(Context cx, Scriptable scope, Object[] args) {
        var promises = JSPromises.get(cx);
        if (promises == null) throw new IllegalStateException("No JS event loop is running");
        try {
            var mr = method.apply(target, context, new JSArguments(args));
            if (mr.getDestination() == null) {
                return promises.resolved(cx, JSObjects.forPromises(cx, () -> JSValues.toJsResult(cx, scope, mr.getResult())));
            }
            var deferred = promises.deferred(cx);
            promises.eventLoop().parkPromise(mr, deferred.waiter());
            return deferred.promise();
        } catch (JSAbort | ContinuationPending e) {
            throw e;
        } catch (RhinoException e) {
            // A JS error raised by a callback the method called.
            return promises.rejected(cx, EventLoop.errorValue(cx, scope, e));
        } catch (ScriptException e) {
            return promises.rejected(cx, JSErrors.newError(cx, scope, e));
        } catch (Exception e) {
            LOG.error("Unexpected exception in native method", e);
            return promises.rejected(cx, EventLoop.newError(cx, scope, "Error", INTERNAL_ERROR_MESSAGE));
        }
    }

    /** Capture the caller's continuation, or fail with a clear error if a Java frame (a native callback) prevents it. */
    private ContinuationPending capture(Context cx, Scriptable scope) {
        try {
            return cx.captureContinuation();
        } catch (IllegalStateException e) {
            // A Java frame (e.g. Array.prototype.forEach, a Promise executor) sits between us and the event loop.
            throw JSPromises.blockingError(cx, scope, name, hint, false);
        }
    }

    private static JavaScriptException jsError(Context cx, Scriptable scope, String message) {
        return ScriptRuntime.throwError(cx, ScriptableObject.getTopLevelScope(scope), message);
    }
}
