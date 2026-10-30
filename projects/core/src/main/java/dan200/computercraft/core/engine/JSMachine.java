// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.core.CoreConfig;
import dan200.computercraft.core.apis.EventsAPI;
import dan200.computercraft.core.computer.TimeoutState;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

public class JSMachine implements IMachine {
    static final String STACK_OVERFLOW_MESSAGE = "stack overflow";
    static final String OUT_OF_MEMORY_MESSAGE = "out of memory";

    // Synthetic CC event name used to keep the JS event loop running when there is pending internal
    // work (microtasks, setImmediate) but no real CC event is incoming.
    private static final String SELF_TICK_EVENT = JSEventEmitter.SELF_TICK_EVENT;
    private static final String TERMINATE_EVENT = "terminate";

    /**
     * Legacy Rhino globals removed from the scope. {@code new Continuation()} would let a script capture (and re-enter)
     * interpreter continuations behind the event loop's back; {@code Script}, {@code With} and {@code Call} expose
     * compiler / scope internals. The interpreter itself does not need these globals: it creates continuations, with
     * and activation objects directly. {@code CallSite} stays, as {@code Error.prepareStackTrace} looks it up by name.
     */
    // __GeneratorFunction: Rhino stores the GeneratorFunction constructor under this name; the TopLevel scope caches
    // it, and scripts reach it the standard way, through Object.getPrototypeOf(function* () {}).constructor.
    private static final List<String> REMOVED_GLOBALS = List.of("Continuation", "Script", "With", "Call", "__GeneratorFunction");

    /**
     * JS bootstrap that installs the global {@code require()} function using the {@code __cc_loader__}
     * infrastructure object.  Module execution is done via {@code new Function()} so that the call
     * happens inside the Rhino interpreter's frame chain — a requirement for
     * {@link Context#captureContinuation()} to work through module boundaries.
     */
    static final String REQUIRE_SETUP_JS = """
        var require;
        (function () {
            var L = __cc_loader__;
            // Shared paths array: all require() functions (root + child) read/write the same variable.
            // Any assignment — require.paths = [...] — updates it for the entire runtime.
            var paths = ["/rom/apis"];

            // Execute a module body in a fresh module scope. When `cached` is true the module object is stored in
            // the cache *before* the body runs (Node semantics), so circular requires see the partially-initialised
            // exports instead of recursing forever; it is evicted again if the body throws.
            function execute(r, cached) {
                var module = { exports: {}, id: r.resolved, filename: r.resolved };
                if (cached) L.setCache(r.resolved, module);
                try {
                    r.fn(module, module.exports, makeRequire(r.dir), r.resolved, r.dir);
                } catch (e) {
                    if (cached) L.deleteCache(r.resolved);
                    throw e;
                }
                return module.exports;
            }

            function makeRequire(currentDir) {
                var fn = function (id) {
                    var r = L.lookup(id, currentDir, paths, false);
                    if (!r || typeof r !== 'object' || !r.__CC_LOAD__) return r;
                    return execute(r, true);
                };
                // Load a module without consulting or populating the cache: its top-level code runs again on
                // every call and always sees the current file contents. Used to run programs.
                fn.uncached = function (id) {
                    var r = L.lookup(id, currentDir, paths, true);
                    if (!r || typeof r !== 'object' || !r.__CC_LOAD__) return r;
                    return execute(r, false);
                };
                // Resolve a module id to its absolute path (or the id itself for native modules) without
                // executing it. Throws MODULE_NOT_FOUND if there is no such module.
                fn.resolve = function (id) {
                    return L.resolve(id, currentDir, paths);
                };
                // Expose paths as a getter/setter so child require() functions also
                // share the same variable — require.paths = [...] works from any module.
                Object.defineProperty(fn, 'paths', {
                    get: function() { return paths; },
                    set: function(v) { paths = v; },
                    enumerable: true, configurable: true
                });
                return fn;
            }
            require = makeRequire('');
        })();
        """;

    private final CCContextFactory factory;
    private final Context cx;
    private final Scriptable scope;
    private final Script biosScript;
    private final TimeoutState timeout;
    private final JSEventEmitter emitter;
    private final Runnable scheduleTick;

    private final EventLoop eventLoop;

    private boolean started = false;
    private volatile boolean isDisposed = false;
    // Guards against queuing multiple cc:js-tick events when the loop is already scheduled.
    private boolean tickPending = false;

    // Read the bios eagerly: ComputerExecutor closes the stream in a try-with-resources
    // immediately after construction, before handleEvent() is ever called.
    public JSMachine(MachineEnvironment environment, InputStream bios) throws IOException {
        var biosSource = new String(bios.readAllBytes(), StandardCharsets.UTF_8);
        timeout = environment.timeout();
        scheduleTick = environment.scheduleTick();

        factory = new CCContextFactory();
        // The context is thread-affine, so we bind it only for the duration of each execution (see handleEvent).
        // Enter it here purely for the setup below, then exit so it isn't left bound to whatever worker thread
        // happened to construct us — that thread may later run a different computer.
        cx = factory.enterContext();
        try {
            // The "safe" standard objects never install LiveConnect (Packages, java, JavaImporter, getClass, …);
            // the deny-all ClassShutter in CCContextFactory stays as a second layer. A TopLevel scope caches the
            // built-in constructors/prototypes; without it Rhino never creates the hidden GeneratorFunction, and
            // generator functions get a null prototype (no call/apply/bind).
            var globals = (ScriptableObject) cx.initSafeStandardObjects(new TopLevel());
            scope = globals;
            for (var name : REMOVED_GLOBALS) ScriptableObject.deleteProperty(globals, name);
            JSLimits.install(globals);

            // Compile bios now so we can use executeScriptWithContinuations later.
            biosScript = cx.compileString(biosSource, "bios.js", 1, null);

            var shim = new JSCallShim(cx, scope);
            eventLoop = new EventLoop(shim, environment.timers());
            emitter = eventLoop.emitter();
            // Lets Java code running inside the machine deliver events synchronously (JSEventEmitter.fireNow).
            emitter.install(cx, scope);
            // Lets native APIs (e.g. fs callbacks) defer JS callbacks onto the event loop.
            JSScheduler.install(cx, scope, eventLoop);
            // Promise jobs, /promises modules, async code detection, and the async + tslib modules.
            var promises = JSPromises.install(cx, scope, eventLoop, shim);

            // Build the module loader and register all CC APIs as native modules. Every native module `x` also gets
            // an `x/promises` flavour whose functions return promises instead of blocking.
            var loader = new JSRequire(scope, environment.fileSystem());
            var context = environment.context();
            var methods = environment.luaMethods();
            // Lets JSValues convert returned Java objects with script methods (handles, dynamic objects, …).
            JSObjects.install(cx, shim, context, methods);
            for (var api : environment.apis()) {
                var moduleName = api.getModuleName();
                if (api.getNames().length == 0 && moduleName == null) continue;

                var name = moduleName != null ? moduleName : api.getNames()[0];
                var obj = JSAPIBuilder.build(cx, scope, shim, api, context, methods, name, false);
                var promiseObj = JSAPIBuilder.build(cx, scope, shim, api, context, methods, name, true);
                for (var alias : api.getNames()) registerNative(loader, alias, obj, promiseObj);
                if (moduleName != null) registerNative(loader, moduleName, obj, promiseObj);
            }

            // Register the engine-internal 'events' module (emitter + scheduler).
            var eventsApi = new EventsAPI(emitter, eventLoop);
            var eventsModule = JSAPIBuilder.build(cx, scope, shim, eventsApi, context, methods, "events", false);
            // events.emit is JS, so the listeners it calls may block (see JSEventEmitter.installEmit).
            emitter.installEmit(cx, scope, eventsModule);
            registerNative(loader, "events", eventsModule,
                JSAPIBuilder.build(cx, scope, shim, eventsApi, context, methods, "events", true));
            // Green threads (parallel.waitForAll/waitForAny/waitForN/spawn), implemented natively in the event loop.
            registerNative(loader, "parallel",
                JSParallel.build(cx, scope, shim, eventLoop, false), JSParallel.build(cx, scope, shim, eventLoop, true));
            // Promise helpers: async.run / async.unwrap, and tslib for tsc's importHelpers output. These are about
            // promises already, so they have no /promises flavour.
            loader.registerNative("async", promises.asyncModule());
            loader.registerNative("tslib", promises.tslibModule());
            // Babel's runtime helpers for code compiled with babel-preset-rhino (classes, spread, …), created on demand.
            loader.registerLazyNative(JSBabelHelpers.MODULE, JSBabelHelpers::create);
            // Engine-internal primitives of the ROM's timers module and the shell's job control (keep-alive).
            loader.registerNative("internal/loop", JSLoopModule.build(cx, scope, shim, eventLoop));

            // Expose loader, run the JS require() setup, then remove the loader from global scope.
            // The setup script captures a reference via closure so require() still works after deletion.
            ScriptableObject.putProperty(scope, "__cc_loader__", loader);
            cx.evaluateString(scope, REQUIRE_SETUP_JS, "require-setup.js", 1, null);
            ScriptableObject.deleteProperty(scope, "__cc_loader__");
        } finally {
            Context.exit();
        }
    }

    /** Register a native module and its {@code /promises} flavour. */
    private static void registerNative(JSRequire loader, String name, Object module, Object promiseModule) {
        loader.registerNative(name, module);
        loader.registerNative(name + "/promises", promiseModule);
    }

    /**
     * Queue a synthetic {@value SELF_TICK_EVENT} CC event if the event loop has pending microtasks or
     * {@code setImmediate} callbacks that cannot self-schedule via a real CC event.
     * At most one tick is queued at a time — {@code tickPending} is cleared when the event is processed.
     */
    private void scheduleSelfTick() {
        if (!tickPending && eventLoop.needsSelfTick()) {
            tickPending = true;
            scheduleTick.run();
        }
    }

    @Override
    public MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        if (isDisposed) return MachineResult.OK;

        // Rhino contexts are thread-affine; bind ours to this worker thread for the duration of the execution.
        // CC runs a given computer on one worker at a time, so the single `cx` is free between events.
        factory.enterContext(cx);
        try {
            if (!started) {
                started = true;
                var biosResult = eventLoop.runBios(cx, scope, biosScript);
                if (biosResult.isError()) { close(); return biosResult; }
                // Start any threads the bios spawned or is waiting for.
                var readyResult = eventLoop.drainMicrotasks(cx, scope);
                if (readyResult.isError()) { close(); return readyResult; }
                // Fire __start__ so any events.on("__start__", cb) listeners run.
                var startResult = emitSafe(JSEventEmitter.START_EVENT, new Object[0]);
                if (startResult.isError()) return startResult;
                var r = eventLoop.drainMicrotasks(cx, scope);
                if (r.isError()) { close(); return r; }
                scheduleSelfTick();
                return MachineResult.OK;
            }

            // Null event after startup is a no-op (Phase 5.4).
            if (eventName == null) return MachineResult.OK;

            // Internal self-tick: drain all internally-queued work without dispatching to JS listeners.
            if (SELF_TICK_EVENT.equals(eventName)) {
                tickPending = false;
                var r1 = eventLoop.drainMicrotasks(cx, scope);
                if (r1.isError()) { close(); return r1; }
                var r2 = eventLoop.drainYields(cx, scope);
                if (r2.isError()) { close(); return r2; }
                var r3 = eventLoop.drainCheck(cx, scope);
                if (r3.isError()) { close(); return r3; }
                scheduleSelfTick();
                return MachineResult.OK;
            }

            var rawArgs = arguments != null ? arguments : new Object[0];
            var fullArgs = buildFullArgs(eventName, rawArgs);

            // Ctrl+T: make the foreground program's blocked calls throw "Terminated" (see EventLoop.terminate).
            if (TERMINATE_EVENT.equals(eventName)) {
                eventLoop.terminate(cx, scope);
                var r = eventLoop.drainMicrotasks(cx, scope);
                if (r.isError()) { close(); return r; }
            }

            // Phase 1 — Timers: wake up os.sleep() continuations whose CC timer just fired.
            if ("timer".equals(eventName) && rawArgs.length >= 1 && rawArgs[0] instanceof Number n) {
                var r = eventLoop.drainTimers(cx, scope, n.intValue());
                if (r.isError()) { close(); return r; }
                r = eventLoop.drainJsTimers(cx, scope, n.intValue());
                if (r.isError()) { close(); return r; }
            }

            // Phase 2 — I/O: resume continuations waiting for this event (+ Phase 3 microtasks).
            var r2 = eventLoop.drainIO(cx, scope, eventName, fullArgs);
            if (r2.isError()) { close(); return r2; }

            // Dispatch os.on() listeners for this event (also I/O phase).
            var emitResult = emitSafe(eventName, toJsArgs(arguments));
            if (emitResult.isError()) return emitResult; // emitSafe already called close()

            // Phase 3 — drain microtasks queued by os.on() listeners.
            var r3 = eventLoop.drainMicrotasks(cx, scope);
            if (r3.isError()) { close(); return r3; }

            // Phase 4 — Yields: resume os.yield() continuations (+ Phase 3 microtasks).
            var r4 = eventLoop.drainYields(cx, scope);
            if (r4.isError()) { close(); return r4; }

            // Phase 5 — Check: run setImmediate callbacks (+ Phase 3 microtasks).
            var r5 = eventLoop.drainCheck(cx, scope);
            if (r5.isError()) { close(); return r5; }

            scheduleSelfTick();
            return MachineResult.OK;

        } catch (JSAbort e) {
            // All JS is entered through EventLoop, which maps aborts itself; this only guards code outside of it.
            close();
            return e.result();
        } catch (StackOverflowError e) {
            // Java-stack recursion (e.g. through native callbacks) bypasses the interpreter's frame limit. Rhino
            // never lets JS catch an Error, so the script is already unwound; stop the machine.
            close();
            return MachineResult.error(STACK_OVERFLOW_MESSAGE);
        } catch (OutOfMemoryError e) {
            // Typically a single oversized allocation (e.g. flattening a huge concatenated string) that the JVM
            // refused, so the heap itself is still intact. Stopping the machine releases everything it holds.
            close();
            return MachineResult.error(OUT_OF_MEMORY_MESSAGE);
        } finally {
            Context.exit();
        }
    }

    /** Convert a Java argument array to JS values for emitter dispatch. */
    private Object[] toJsArgs(@Nullable Object @Nullable [] args) {
        if (args == null) return new Object[0];
        var result = new Object[args.length];
        for (int i = 0; i < args.length; i++) result[i] = JSValues.toJs(cx, scope, args[i]);
        return result;
    }

    private static Object[] buildFullArgs(String eventName, Object[] args) {
        var fullArgs = new Object[args.length + 1];
        fullArgs[0] = eventName;
        System.arraycopy(args, 0, fullArgs, 1, args.length);
        return fullArgs;
    }

    /**
     * Invoke the {@code events.on} listeners for {@code event}. Each runs as a strand of the thread that registered
     * it, so blocking calls park and errors in a thread's listener fail that thread (see {@link EventLoop#emit}).
     */
    private MachineResult emitSafe(String event, Object[] jsArgs) {
        var result = eventLoop.emit(cx, scope, event, jsArgs);
        if (result.isError()) close();
        return result;
    }

    @Override
    public void printExecutionState(StringBuilder out) {
    }

    @Override
    public void close() {
        if (isDisposed) return;
        isDisposed = true;
        eventLoop.clear();
        // The context is entered/exited per execution (constructor + handleEvent), not held open across the
        // machine's lifetime, so there is nothing to exit here — and close() may run on a thread that never
        // entered it.
    }

    /**
     * Our Rhino context: promise jobs go to the {@link EventLoop}'s microtask queue rather than Rhino's own, so they run
     * as part of the event loop (with thread ownership and abort handling) instead of never.
     */
    private final class CCContext extends Context {
        CCContext(ContextFactory factory) {
            super(factory);
        }

        @Override
        public void enqueueMicrotask(Runnable task) {
            // The event loop is created after the context; nothing settles a promise before then.
            var loop = eventLoop;
            if (loop != null) {
                loop.schedulePromiseJob(task);
            } else {
                super.enqueueMicrotask(task);
            }
        }
    }

    private final class CCContextFactory extends ContextFactory {
        @Override
        @SuppressWarnings("deprecation") // setOptimizationLevel(-1) = interpreter mode; required for continuations
        protected Context makeContext() {
            var cx = new CCContext(this);
            cx.setOptimizationLevel(-1);
            cx.setLanguageVersion(Context.VERSION_ECMASCRIPT);
            cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold);
            // Interpreter frames live on the heap, so unbounded recursion would otherwise eat memory until timeout.
            cx.setMaximumInterpreterStackDepth(CoreConfig.jsMaxStackDepth);
            cx.setClassShutter(className -> false);
            return cx;
        }

        @Override
        protected void observeInstructionCount(Context cx, int instructionCount) {
            if (isDisposed || timeout.isHardAborted()) throw abort(JSAbort.hard());
            if (timeout.isSoftAborted()) throw abort(JSAbort.soft());
            // TimeoutState.isPaused() (timeslice used up while other computers wait) is deliberately not honoured
            // here: Rhino cannot suspend arbitrary code at a safepoint, and nothing clears the flag while the machine
            // is still running, so waiting for it only ended in "Too long without yielding". The computer gives up
            // its thread at the next blocking call or when the event is handled.
        }

        /** Tell the event loop, as Rhino's promise machinery would otherwise swallow the abort. */
        private JSAbort abort(JSAbort abort) {
            var loop = eventLoop;
            return loop != null ? loop.noteAbort(abort) : abort;
        }
    }
}
