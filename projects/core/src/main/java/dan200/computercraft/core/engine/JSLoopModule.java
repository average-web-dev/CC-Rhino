// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.*;

/**
 * The engine-internal {@code internal/loop} module: the primitives behind the ROM's {@code timers} module
 * ({@code /rom/lib/timers}, #45) and the shell's job control ({@code /rom/lib/internal/tty}, #46). It is not a public
 * API: it works in ticks and on plain ids.
 *
 * <ul>
 *   <li>Timers ({@link JSTimers}): {@code schedule(fn, ticks, repeat, ref, reuseId?) → id}, {@code cancel(id) →
 *   boolean}, {@code refresh(id) → boolean}, {@code ref(id, flag)}. {@code fn} is called without arguments as a strand
 *   of the calling thread; it must be an interpreted JS function (it is entered with continuations, so it may
 *   block).</li>
 *   <li>Keep-alive handles ({@link EventLoop#createHandle}): {@code handle() → id}, {@code handleRef(id, flag)},
 *   {@code handleClose(id)}.</li>
 *   <li>{@code waitIdle() → boolean}: block until the calling thread is idle ({@link EventLoop#isIdle}) and return
 *   {@code true}, or until {@code wakeIdle()} is called and return {@code false}. Ctrl+T reaches it like any blocking
 *   call.</li>
 *   <li>Thread context ({@link JSThread#context()}): {@code setContext(value, tty?)} attaches a value (and the id of
 *   the TTY the program runs on, for Ctrl+T) to the calling thread, {@code context()} returns the calling thread's (or
 *   its nearest ancestor's); descendants inherit it, also after their parent returned. The ROM's job control keeps the
 *   running program's TTY, argv and directory there. A thread with a context is where a program's foreground starts
 *   (see {@link JSThread#isForeground()}).</li>
 * </ul>
 */
final class JSLoopModule {
    private JSLoopModule() {
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

    static Scriptable build(Context cx, Scriptable scope, JSCallShim shim, EventLoop eventLoop) {
        var timers = eventLoop.timers();
        var module = cx.newObject(scope);

        put(cx, scope, module, new NativeFunction("schedule", (c, s, args) -> {
            if (args.length == 0 || !(args[0] instanceof Callable fn)) {
                throw ScriptRuntime.typeError("bad argument #1 (function expected, got " + typeOf(args, 0) + ")");
            }
            var owner = eventLoop.currentThread();
            if (owner.isDead()) return -1;
            var ticks = (long) Math.max(1, Math.min(Integer.MAX_VALUE, number(args, 1)));
            return timers.schedule(owner, fn, ticks, bool(args, 2), bool(args, 3), (int) number(args, 4));
        }));
        put(cx, scope, module, new NativeFunction("cancel", (c, s, args) -> timers.cancel((int) number(args, 0))));
        put(cx, scope, module, new NativeFunction("refresh", (c, s, args) -> timers.refresh((int) number(args, 0))));
        put(cx, scope, module, new NativeFunction("ref", (c, s, args) -> {
            timers.setRef((int) number(args, 0), bool(args, 1));
            return Undefined.instance;
        }));

        put(cx, scope, module, new NativeFunction("handle", (c, s, args) -> eventLoop.createHandle()));
        put(cx, scope, module, new NativeFunction("handleRef", (c, s, args) -> {
            eventLoop.setHandleRef((int) number(args, 0), bool(args, 1));
            return Undefined.instance;
        }));
        put(cx, scope, module, new NativeFunction("handleClose", (c, s, args) -> {
            eventLoop.closeHandle((int) number(args, 0));
            return Undefined.instance;
        }));

        var waitIdle = new NativeFunction("waitIdle", (c, s, args) -> {
            var name = "waitIdle";
            var hint = "a promise";
            var support = JSPromises.get(c);
            if (support != null && support.inAsyncCode()) throw JSPromises.blockingError(c, s, name, hint, true);
            ContinuationPending pending;
            try {
                pending = c.captureContinuation();
            } catch (IllegalStateException e) {
                throw JSPromises.blockingError(c, s, name, hint, false);
            }
            pending.setApplicationState(new EventLoop.IdleRequest());
            throw pending;
        });
        ScriptableObject.putProperty(module, "waitIdle", shim.wrap(cx, scope, waitIdle));
        put(cx, scope, module, new NativeFunction("wakeIdle", (c, s, args) -> {
            eventLoop.wakeIdle();
            return Undefined.instance;
        }));

        put(cx, scope, module, new NativeFunction("context", (c, s, args) -> {
            var context = eventLoop.currentThread().context();
            return context == null ? Undefined.instance : context;
        }));
        put(cx, scope, module, new NativeFunction("setContext", (c, s, args) -> {
            var value = args.length == 0 || args[0] == Undefined.instance || args[0] == null ? null : args[0];
            var thread = eventLoop.currentThread();
            thread.context = value;
            thread.terminal = (int) number(args, 1);
            return Undefined.instance;
        }));
        return module;
    }

    private static void put(Context cx, Scriptable scope, Scriptable module, NativeFunction fn) {
        ScriptRuntime.setFunctionProtoAndParent(fn, cx, scope);
        ScriptableObject.putProperty(module, fn.name, fn);
    }

    private static double number(Object[] args, int index) {
        if (index >= args.length || args[index] == Undefined.instance) return 0;
        var value = ScriptRuntime.toNumber(args[index]);
        return Double.isNaN(value) ? 0 : value;
    }

    private static boolean bool(Object[] args, int index) {
        return index < args.length && ScriptRuntime.toBoolean(args[index]);
    }

    private static String typeOf(Object[] args, int index) {
        return index < args.length ? ScriptRuntime.typeof(args[index]) : "no value";
    }
}
