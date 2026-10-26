// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.*;

import java.util.ArrayList;
import java.util.List;

/**
 * The native {@code parallel} module — {@code require('parallel')}: green threads with structured concurrency,
 * modelled on CC's {@code parallel} API.
 *
 * <ul>
 *   <li>{@code waitForAll(...tasks)}, {@code waitForAny(...tasks)} and {@code waitForN(n, ...tasks)} run each task as
 *   a {@link JSThread} and block the caller until all / one / {@code n} of them have returned. The caller's
 *   continuation is parked inside the event loop (not on the CC event queue) and resumed by the threads themselves,
 *   so waiting costs nothing while every thread is blocked. Threads still running when the call returns are stopped,
 *   and if a task throws, its siblings are stopped and the error is rethrown from the {@code waitFor*} call.</li>
 *   <li>{@code spawn(task)} starts a background thread and returns a handle that can stop it.</li>
 * </ul>
 *
 * <p>Like the methods of every other native module, the blocking functions are wrapped by {@link JSCallShim}, so a
 * failure they are resumed with is thrown at the call site.
 */
final class JSParallel {
    private JSParallel() {
    }

    @FunctionalInterface
    private interface Body {
        Object call(Context cx, Scriptable scope, Object[] args);
    }

    @SuppressWarnings("serial") // never serialized
    private static final class NativeFunction extends BaseFunction {
        private static final long serialVersionUID = 1L;

        private final String name;
        private final Body body;

        NativeFunction(String name, Body body) {
            this.name = name;
            this.body = body;
        }

        @Override
        public String getFunctionName() {
            return name;
        }

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            return body.call(cx, scope, args);
        }
    }

    /**
     * Build the {@code parallel} module, or with {@code promises} the {@code parallel/promises} module: there the
     * {@code waitFor*} functions return a promise settled with the group (the caller keeps running), and {@code spawn}
     * an already-resolved promise of the handle. Invalid arguments reject the promise.
     */
    static Scriptable build(Context cx, Scriptable scope, JSCallShim shim, EventLoop eventLoop, boolean promises) {
        var module = cx.newObject(scope);
        put(module, "waitForAll", blocking(cx, scope, shim, promises, new NativeFunction("waitForAll",
            (c, s, args) -> waitFor(c, s, promises, JSTaskGroup.Mode.ALL, -1, tasks(args, 0)))));
        put(module, "waitForAny", blocking(cx, scope, shim, promises, new NativeFunction("waitForAny",
            (c, s, args) -> waitFor(c, s, promises, JSTaskGroup.Mode.ANY, 1, tasks(args, 0)))));
        put(module, "waitForN", blocking(cx, scope, shim, promises, new NativeFunction("waitForN", (c, s, args) -> {
            if (args.length == 0 || !(args[0] instanceof Number count)) {
                throw ScriptRuntime.typeError("bad argument #1 (number expected, got " + typeOf(args, 0) + ")");
            }
            return waitFor(c, s, promises, JSTaskGroup.Mode.N, (int) Math.max(0, count.doubleValue()), tasks(args, 1));
        })));
        put(module, "spawn", function(cx, scope, promised(promises, new NativeFunction("spawn", (c, s, args) -> {
            var task = tasks(args, 0);
            if (task.size() != 1) throw ScriptRuntime.typeError("bad argument #1 (function expected, got no value)");
            return handle(c, s, eventLoop, eventLoop.spawn(task.getFirst()));
        }))));
        return module;
    }

    /** A {@code waitFor*} function: behind the call shim when blocking, returning a promise otherwise. */
    private static Object blocking(Context cx, Scriptable scope, JSCallShim shim, boolean promises, NativeFunction fn) {
        return promises ? function(cx, scope, promised(true, fn)) : shim.wrap(cx, scope, fn);
    }

    /** In the promise flavour, turn a synchronous result into a resolved promise and a thrown error into a rejected one. */
    private static NativeFunction promised(boolean promises, NativeFunction fn) {
        if (!promises) return fn;
        return new NativeFunction(fn.name, (c, s, args) -> {
            var support = JSPromises.get(c);
            if (support == null) throw new IllegalStateException("No JS event loop is running");
            Object result;
            try {
                result = fn.body.call(c, s, args);
            } catch (JSAbort e) {
                throw e;
            } catch (RhinoException e) {
                return support.rejected(c, EventLoop.errorValue(c, s, e));
            }
            return result instanceof NativePromise ? result : support.resolved(c, result);
        });
    }

    /**
     * Wait until {@code needed} of {@code tasks} have returned. A blocking call captures its continuation here and the
     * {@link EventLoop} starts the threads once it parks it — JS is never run from inside this native call. A
     * promise call starts the threads once the caller yields, and returns a promise settled with the group.
     */
    private static Object waitFor(
        Context cx, Scriptable scope, boolean promises, JSTaskGroup.Mode mode, int needed, List<Callable> tasks
    ) {
        var target = needed < 0 ? tasks.size() : Math.min(needed, tasks.size());
        if (target == 0) {
            return switch (mode) {
                case ALL -> Undefined.instance;
                case ANY -> -1;
                case N -> 0;
            };
        }

        var request = new JSTaskGroup.Request(mode, target, tasks);
        var support = JSPromises.get(cx);
        if (promises && support != null) {
            var deferred = support.deferred(cx);
            support.eventLoop().startPromiseGroup(request, deferred.waiter());
            return deferred.promise();
        }

        var name = "parallel." + switch (mode) {
            case ALL -> "waitForAll";
            case ANY -> "waitForAny";
            case N -> "waitForN";
        };
        var hint = "require('parallel/promises')";
        if (support != null && support.inAsyncCode()) throw JSPromises.blockingError(cx, scope, name, hint, true);
        ContinuationPending pending;
        try {
            pending = cx.captureContinuation();
        } catch (IllegalStateException e) {
            throw JSPromises.blockingError(cx, scope, name, hint, false);
        }
        pending.setApplicationState(request);
        throw pending;
    }

    private static List<Callable> tasks(Object[] args, int offset) {
        var tasks = new ArrayList<Callable>(Math.max(0, args.length - offset));
        for (var i = offset; i < args.length; i++) {
            if (!(args[i] instanceof Callable task)) {
                throw ScriptRuntime.typeError("bad argument #" + (i + 1) + " (function expected, got " + typeOf(args, i) + ")");
            }
            tasks.add(task);
        }
        return tasks;
    }

    /** The JS handle returned by {@code spawn}: {@code { id, stop(), isAlive(), getError() }}. */
    private static Scriptable handle(Context cx, Scriptable scope, EventLoop eventLoop, JSThread thread) {
        var handle = cx.newObject(scope);
        put(handle, "id", thread.id);
        put(handle, "stop", function(cx, scope, new NativeFunction("stop", (c, s, args) -> {
            eventLoop.stop(thread);
            return Undefined.instance;
        })));
        put(handle, "isAlive", function(cx, scope, new NativeFunction("isAlive",
            (c, s, args) -> thread.state == JSThread.State.RUNNING)));
        put(handle, "getError", function(cx, scope, new NativeFunction("getError", (c, s, args) -> {
            var error = thread.error;
            return error == null ? Undefined.instance : error;
        })));
        return handle;
    }

    private static Object function(Context cx, Scriptable scope, BaseFunction fn) {
        ScriptRuntime.setFunctionProtoAndParent(fn, cx, scope);
        return fn;
    }

    private static void put(Scriptable object, String name, Object value) {
        ScriptableObject.putProperty(object, name, value);
    }

    private static String typeOf(Object[] args, int index) {
        return index < args.length ? ScriptRuntime.typeof(args[index]) : "no value";
    }
}
