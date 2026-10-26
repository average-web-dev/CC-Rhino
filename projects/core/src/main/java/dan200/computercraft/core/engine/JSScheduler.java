// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.Scriptable;

/**
 * Lets native APIs defer a JS callback to the event loop instead of invoking it from inside a Java frame.
 *
 * <p>A callback invoked directly from Java ({@code fn.call(...)}) cannot use blocking APIs, because Rhino can only
 * capture a continuation when every frame up to the top call is interpreted JS. {@link #callLater} instead queues the
 * callback as a {@code setImmediate}-style task; the {@link EventLoop} runs it through
 * {@code callFunctionWithContinuations} once the current call has returned, so it may block like any listener.
 *
 * <p>Each {@link JSMachine} installs its scheduler as a thread-local of its (per-machine) {@link Context}, so APIs
 * look it up from the context that is currently executing them and need no reference to the machine.
 */
public final class JSScheduler {
    private static final Object KEY = JSScheduler.class;

    // Binds arguments in an interpreted closure: callFunctionWithContinuations only accepts interpreted functions,
    // and the event loop calls queued tasks without arguments.
    private static final String BIND_JS = """
        (function (fn, args) {
            return function () { return fn.apply(undefined, args); };
        })
        """;

    private final EventLoop eventLoop;
    private final Scriptable scope;
    private final Function bind;

    private JSScheduler(Context cx, Scriptable scope, EventLoop eventLoop) {
        this.eventLoop = eventLoop;
        this.scope = scope;
        bind = (Function) cx.evaluateString(scope, BIND_JS, "scheduler.js", 1, null);
    }

    /** Create the scheduler for a machine and attach it to the machine's context. */
    static void install(Context cx, Scriptable scope, EventLoop eventLoop) {
        cx.putThreadLocal(KEY, new JSScheduler(cx, scope, eventLoop));
    }

    /**
     * Run {@code fn(...jsArgs)} on the next event-loop tick (the {@code setImmediate} phase).
     *
     * @param fn     The JS function to call.
     * @param jsArgs Arguments, already converted to JS values.
     * @throws IllegalStateException If not called from a JS machine's execution.
     */
    public static void callLater(Callable fn, @Nullable Object... jsArgs) {
        var cx = Context.getCurrentContext();
        var scheduler = cx == null ? null : (JSScheduler) cx.getThreadLocal(KEY);
        if (scheduler == null) throw new IllegalStateException("No JS event loop is running");

        var task = (Callable) scheduler.bind.call(cx, scheduler.scope, scheduler.scope,
            new Object[]{ fn, cx.newArray(scheduler.scope, jsArgs) });
        scheduler.eventLoop.scheduleImmediate(task);
    }
}
