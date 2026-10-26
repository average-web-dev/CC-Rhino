// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

/**
 * Promise support of the JS machine: the {@code async} and {@code tslib} modules, promise creation for the
 * {@code /promises} modules, and the instrumentation that lets the engine tell async code apart.
 *
 * <h2>Async code</h2>
 * Rhino resumes generators and runs promise jobs through Java, so JS running there cannot capture a continuation, and
 * blocking calls cannot work. To give a clear error <em>before</em> a blocking native method runs (and has side
 * effects), the engine tracks when it is in such code: {@code %GeneratorPrototype%.next/throw/return} are replaced by
 * wrappers counting generator resumptions, and the {@link EventLoop} marks promise jobs. See
 * {@link EventLoop#inAsyncCode()}.
 *
 * <h2>Reaction ownership</h2>
 * {@code Promise.prototype.then} is replaced by a wrapper that ties each reaction to the {@linkplain JSThread thread}
 * registering it ({@code catch}, {@code finally}, {@code Promise.all} etc. all go through {@code then}). A reaction runs
 * as a strand of that thread, so work it starts belongs there, and it never runs once that thread has been stopped:
 * its derived promise then stays pending, so the rest of the chain is discarded as well. Stopping a thread therefore
 * silently discards its own promise chains, while a promise another thread is waiting for still settles (a pending
 * native operation of a stopped thread rejects with {@code Error("Terminated")}, see {@link EventLoop}).
 *
 * <h2>Unhandled rejections</h2>
 * The global {@code Promise} is replaced by a constructor reporting every new promise to the {@link EventLoop}, which
 * reports a rejection that has no handler by the end of a microtask drain (see {@link EventLoop#checkRejections}).
 * {@code then} marks a promise as handled.
 *
 * <p>Installed on the machine's Rhino context by {@link JSMachine}, in the same way as {@link JSScheduler}.
 */
final class JSPromises {
    private static final Object KEY = JSPromises.class;

    /**
     * The tslib-compatible helpers ({@code require('tslib')}, used by tsc's {@code importHelpers} output) and the
     * {@code async} module. {@code __awaiter} is tslib's implementation; {@code async.run} is the same helper for
     * plain JS.
     */
    private static final String ASYNC_JS = """
        (function (Promise, unwrap) {
            var apply = Function.prototype.apply;

            function __awaiter(thisArg, _arguments, P, generator) {
                function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
                return new (P || (P = Promise))(function (resolve, reject) {
                    function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
                    function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
                    function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
                    // Rhino's generator functions do not inherit from Function.prototype: borrow apply.
                    step((generator = apply.call(generator, thisArg, _arguments || [])).next());
                });
            }

            function __assign(target) {
                return Object.assign.apply(Object, arguments);
            }

            function __rest(s, e) {
                var t = {};
                for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
                if (s != null && typeof Object.getOwnPropertySymbols === "function") {
                    var symbols = Object.getOwnPropertySymbols(s);
                    for (var i = 0; i < symbols.length; i++) {
                        if (e.indexOf(symbols[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, symbols[i])) {
                            t[symbols[i]] = s[symbols[i]];
                        }
                    }
                }
                return t;
            }

            // Async generators and `for await` (tsc's output for es2015). Same algorithms as tslib's; they need
            // Symbol.asyncIterator, which Rhino lacks and the engine polyfills.
            function __await(v) {
                return this instanceof __await ? (this.v = v, this) : new __await(v);
            }

            function __asyncGenerator(thisArg, _arguments, generator) {
                if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
                var g = apply.call(generator, thisArg, _arguments || []), i, q = [];
                i = Object.create(Object.prototype);
                verb("next");
                verb("throw");
                verb("return", awaitReturn);
                i[Symbol.asyncIterator] = function () { return this; };
                return i;
                function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
                function verb(n, f) {
                    if (g[n]) {
                        i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); };
                        if (f) i[n] = f(i[n]);
                    }
                }
                function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
                function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
                function fulfill(value) { resume("next", value); }
                function reject(value) { resume("throw", value); }
                function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
            }

            function __asyncDelegator(o) {
                var i = {}, p;
                verb("next");
                verb("throw", function (e) { throw e; });
                verb("return");
                i[Symbol.iterator] = function () { return this; };
                return i;
                function verb(n, f) {
                    i[n] = o[n] ? function (v) { return (p = !p) ? { value: __await(o[n](v)), done: false } : f ? f(v) : v; } : f;
                }
            }

            function __asyncValues(o) {
                if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
                var m = o[Symbol.asyncIterator], i;
                if (m) return m.call(o);
                o = o[Symbol.iterator]();
                i = {};
                verb("next");
                verb("throw");
                verb("return");
                i[Symbol.asyncIterator] = function () { return this; };
                return i;
                function verb(n) {
                    i[n] = o[n] && function (v) {
                        return new Promise(function (resolve, reject) { v = o[n](v); settle(resolve, reject, v.done, v.value); });
                    };
                }
                function settle(resolve, reject, d, v) {
                    Promise.resolve(v).then(function (v) { resolve({ value: v, done: d }); }, reject);
                }
            }

            function run(fn) {
                if (typeof fn !== "function") throw new TypeError("bad argument #1 (function expected, got " + typeof fn + ")");
                return __awaiter(undefined, Array.prototype.slice.call(arguments, 1), Promise, fn);
            }

            return [
                {
                    __awaiter: __awaiter, __assign: __assign, __rest: __rest, __await: __await,
                    __asyncGenerator: __asyncGenerator, __asyncDelegator: __asyncDelegator, __asyncValues: __asyncValues,
                },
                { run: run, unwrap: unwrap },
            ];
        })
        """;

    /** Defines the well-known {@code Symbol.asyncIterator}, which Rhino 1.9.1 lacks (needed by {@code for await}). */
    private static final String ASYNC_ITERATOR_JS = """
        if (typeof Symbol.asyncIterator !== "symbol") {
            Object.defineProperty(Symbol, "asyncIterator", { value: Symbol("Symbol.asyncIterator") });
        }
        """;

    /** Application state of the continuation captured by {@code async.unwrap}: the promise it waits for. */
    record Await(Scriptable thenable) {
    }

    /** A new pending promise and the waiter that settles it. */
    record Deferred(Scriptable promise, Waiter.Promised waiter) {
    }

    @FunctionalInterface
    private interface Body {
        Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args);
    }

    @SuppressWarnings("serial") // never serialized
    private static final class NativeFunction extends BaseFunction {
        private static final long serialVersionUID = 1L;

        private final String name;
        private final int arity;
        private final Body body;

        NativeFunction(String name, int arity, Body body) {
            this.name = name;
            this.arity = arity;
            this.body = body;
        }

        @Override
        public String getFunctionName() {
            return name;
        }

        @Override
        public int getArity() {
            return arity;
        }

        @Override
        public int getLength() {
            return arity;
        }

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            return body.call(cx, scope, thisObj, args);
        }
    }

    /** The global {@code Promise}: the original constructor, plus reporting each new promise to the event loop. */
    @SuppressWarnings("serial") // never serialized
    private final class PromiseConstructor extends BaseFunction {
        private static final long serialVersionUID = 1L;

        private final Function original;

        PromiseConstructor(Function original, Scriptable prototype) {
            this.original = original;
            setImmunePrototypeProperty(prototype);
        }

        @Override
        public String getFunctionName() {
            return "Promise";
        }

        @Override
        public int getArity() {
            return 1;
        }

        @Override
        public int getLength() {
            return 1;
        }

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            return original.call(cx, scope, thisObj, args); // TypeError: Promise requires new
        }

        @Override
        public Scriptable construct(Context cx, Scriptable scope, Object[] args) {
            var promise = original.construct(cx, scope, args);
            eventLoop.promiseCreated(promise);
            return promise;
        }
    }

    private final EventLoop eventLoop;
    private final Scriptable scope;
    private final Function promiseConstructor;
    private final Scriptable tslibModule;
    private final Scriptable asyncModule;

    private JSPromises(Context cx, Scriptable scope, EventLoop eventLoop, JSCallShim shim) {
        this.eventLoop = eventLoop;
        this.scope = scope;

        // Replace the global Promise constructor with one that reports every promise it creates to the event loop, for
        // unhandled-rejection tracking (Rhino's own tracker keeps a static map shared by every computer). It shares
        // the prototype and static methods, and is the prototype's constructor and its own species, so the promises
        // Rhino creates for then/all/race/… go through it too. Keep a reference: scripts may replace the global.
        var nativePromise = (Function) ScriptableObject.getProperty(scope, "Promise");
        var promiseProto = (ScriptableObject) nativePromise.get("prototype", nativePromise);
        var constructor = new PromiseConstructor(nativePromise, promiseProto);
        ScriptRuntime.setFunctionProtoAndParent(constructor, cx, scope);
        for (var name : new String[]{ "resolve", "reject", "all", "allSettled", "any", "race", "withResolvers" }) {
            var value = ScriptableObject.getProperty(nativePromise, name);
            if (value != Scriptable.NOT_FOUND) constructor.defineProperty(name, value, ScriptableObject.DONTENUM);
        }
        constructor.put(SymbolKey.SPECIES, constructor, constructor);
        promiseProto.defineProperty("constructor", constructor, ScriptableObject.DONTENUM);
        ScriptableObject.defineProperty(scope, "Promise", constructor, ScriptableObject.DONTENUM);
        promiseConstructor = constructor;

        var then = (Callable) ScriptableObject.getProperty(promiseProto, "then");
        eventLoop.trackPromises(then);
        promiseProto.defineProperty("then", function(cx, new NativeFunction("then", 2, (c, s, thisObj, args) -> {
            eventLoop.promiseHandled(thisObj);
            var owner = eventLoop.currentThread();
            return then.call(c, s, thisObj, new Object[]{ own(c, owner, arg(args, 0)), own(c, owner, arg(args, 1)) });
        })), ScriptableObject.DONTENUM);

        var generatorProto = (ScriptableObject) cx.evaluateString(scope,
            "Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()))", "promises.js", 1, null);
        for (var name : new String[]{ "next", "throw", "return" }) {
            var original = (Callable) ScriptableObject.getProperty(generatorProto, name);
            generatorProto.defineProperty(name, function(cx, new NativeFunction(name, 1, (c, s, thisObj, args) -> {
                eventLoop.enterGenerator();
                try {
                    return original.call(c, s, thisObj, args);
                } finally {
                    eventLoop.exitGenerator();
                }
            })), ScriptableObject.DONTENUM);
        }

        cx.evaluateString(scope, ASYNC_ITERATOR_JS, "async-iterator.js", 1, null);

        var unwrap = shim.wrap(cx, scope, new NativeFunction("unwrap", 1, (c, s, thisObj, args) -> unwrap(c, s, arg(args, 0))));
        var factory = (Function) cx.evaluateString(scope, ASYNC_JS, "async.js", 1, null);
        var modules = (Scriptable) factory.call(cx, scope, scope, new Object[]{ promiseConstructor, unwrap });
        tslibModule = (Scriptable) modules.get(0, modules);
        asyncModule = (Scriptable) modules.get(1, modules);
    }

    /** Create the promise support for a machine and attach it to the machine's context. */
    static JSPromises install(Context cx, Scriptable scope, EventLoop eventLoop, JSCallShim shim) {
        var promises = new JSPromises(cx, scope, eventLoop, shim);
        cx.putThreadLocal(KEY, promises);
        return promises;
    }

    /** The promise support of the machine running on {@code cx}, if any. */
    static @Nullable JSPromises get(Context cx) {
        return (JSPromises) cx.getThreadLocal(KEY);
    }

    EventLoop eventLoop() {
        return eventLoop;
    }

    /** The {@code tslib} module: tslib-compatible helpers for tsc's {@code importHelpers} output. */
    Scriptable tslibModule() {
        return tslibModule;
    }

    /** The {@code async} module: {@code run(generatorFn, ...args)} and {@code unwrap(promise)}. */
    Scriptable asyncModule() {
        return asyncModule;
    }

    /** See {@link EventLoop#inAsyncCode()}. */
    boolean inAsyncCode() {
        return eventLoop.inAsyncCode();
    }

    /**
     * The error thrown when a blocking function is called where it cannot block.
     *
     * @param name      The function, e.g. {@code turtle.dig}.
     * @param hint      What to use instead, e.g. {@code require('turtle/promises')}.
     * @param asyncCode Whether we know we are in async code; otherwise some other Java frame (a native callback)
     *                  prevented capturing a continuation.
     */
    static JavaScriptException blockingError(Context cx, Scriptable scope, String name, String hint, boolean asyncCode) {
        var where = asyncCode ? "inside async code" : "inside async code or callbacks run by native code "
            + "(such as Array.prototype.forEach, or a listener of another thread called by events.emit)";
        return ScriptRuntime.throwError(cx, ScriptableObject.getTopLevelScope(scope),
            name + " blocks and cannot be used " + where + " — use " + hint + " instead");
    }

    /** A new pending promise. */
    Deferred deferred(Context cx) {
        var settle = new Object[2];
        var executor = new NativeFunction("executor", 2, (c, s, thisObj, args) -> {
            settle[0] = args[0];
            settle[1] = args[1];
            return Undefined.instance;
        });
        var promise = promiseConstructor.construct(cx, scope, new Object[]{ function(cx, executor) });
        return new Deferred(promise, new Waiter.Promised((Function) settle[0], (Function) settle[1]));
    }

    /** A promise resolved with {@code value}. */
    Scriptable resolved(Context cx, @Nullable Object value) {
        var deferred = deferred(cx);
        deferred.waiter().resolve().call(cx, scope, scope, new Object[]{ value });
        return deferred.promise();
    }

    /** A promise rejected with {@code error}. */
    Scriptable rejected(Context cx, Object error) {
        var deferred = deferred(cx);
        deferred.waiter().reject().call(cx, scope, scope, new Object[]{ error });
        return deferred.promise();
    }

    /**
     * {@code async.unwrap(value)}: block until a promise (any thenable) settles, then return its value or throw its
     * reason. Anything else is returned unchanged, as with {@code await}.
     */
    private Object unwrap(Context cx, Scriptable scope, Object value) {
        if (!(value instanceof Scriptable thenable) || !(ScriptableObject.getProperty(thenable, "then") instanceof Callable)) {
            return value;
        }
        var hint = "yield (inside async.run) or await";
        if (eventLoop.inAsyncCode()) throw blockingError(cx, scope, "async.unwrap", hint, true);
        ContinuationPending pending;
        try {
            pending = cx.captureContinuation();
        } catch (IllegalStateException e) {
            throw blockingError(cx, scope, "async.unwrap", hint, false);
        }
        pending.setApplicationState(new Await(thenable));
        throw pending;
    }

    /** Tie a reaction handler to the thread registering it (see the class docs). */
    private Object own(Context cx, JSThread owner, Object handler) {
        if (!(handler instanceof Callable fn) || owner.isRoot()) return handler;
        return function(cx, new NativeFunction("", 1, (c, s, thisObj, args) -> {
            // A stopped thread's reaction never runs; a promise that never settles discards the rest of its chain.
            if (owner.isDead()) return deferred(c).promise();
            return eventLoop.callAs(owner, c, s, fn, thisObj, args);
        }));
    }

    private BaseFunction function(Context cx, BaseFunction fn) {
        ScriptRuntime.setFunctionProtoAndParent(fn, cx, scope);
        return fn;
    }

    private static Object arg(Object[] args, int index) {
        return index < args.length ? args[index] : Undefined.instance;
    }
}
