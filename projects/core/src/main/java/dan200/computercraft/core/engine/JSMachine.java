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
import java.util.concurrent.locks.LockSupport;

public class JSMachine implements IMachine {
    // Package-visible so EventLoop.mapEvaluator() can compare against it.
    static final String HARD_ABORT_MESSAGE = "hard abort";
    static final String STACK_OVERFLOW_MESSAGE = "stack overflow";
    static final String OUT_OF_MEMORY_MESSAGE = "out of memory";

    // Synthetic CC event name used to keep the JS event loop running when there is pending internal
    // work (microtasks, setImmediate) but no real CC event is incoming.
    private static final String SELF_TICK_EVENT = "cc:js-tick";

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

    // Stored by observeInstructionCount so the abort listener can unpark this thread.
    private volatile @Nullable Thread executionThread;
    private @Nullable Runnable abortListener;

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
            // the deny-all ClassShutter in CCContextFactory stays as a second layer.
            var globals = cx.initSafeStandardObjects();
            scope = globals;
            JSLimits.install(globals);

            // Compile bios now so we can use executeScriptWithContinuations later.
            biosScript = cx.compileString(biosSource, "bios.js", 1, null);

            emitter = new JSEventEmitter();
            var shim = new JSCallShim(cx, scope);
            eventLoop = new EventLoop(shim);
            // Lets native APIs (e.g. fs callbacks) defer JS callbacks onto the event loop.
            JSScheduler.install(cx, scope, eventLoop);

            // Build the module loader and register all CC APIs as native modules.
            var loader = new JSRequire(scope, environment.fileSystem());
            var context = environment.context();
            var methods = environment.luaMethods();
            for (var api : environment.apis()) {
                var moduleName = api.getModuleName();
                if (api.getNames().length == 0 && moduleName == null) continue;

                var obj = JSAPIBuilder.build(cx, scope, shim, api, context, methods);
                for (var name : api.getNames()) loader.registerNative(name, obj);
                if (moduleName != null) loader.registerNative(moduleName, obj);
            }

            // Register the engine-internal 'events' module (emitter + scheduler).
            var eventsApi = new EventsAPI(emitter, eventLoop);
            loader.registerNative("events", JSAPIBuilder.build(cx, scope, shim, eventsApi, context, methods));

            // Expose loader, run the JS require() setup, then remove the loader from global scope.
            // The setup script captures a reference via closure so require() still works after deletion.
            ScriptableObject.putProperty(scope, "__cc_loader__", loader);
            cx.evaluateString(scope, REQUIRE_SETUP_JS, "require-setup.js", 1, null);
            ScriptableObject.deleteProperty(scope, "__cc_loader__");

            // Wake up the pause spin-loop immediately when a hard abort is requested.
            abortListener = () -> {
                if (timeout.isHardAborted()) {
                    var t = executionThread;
                    if (t != null) LockSupport.unpark(t);
                }
            };
            timeout.addListener(abortListener);
        } finally {
            Context.exit();
        }
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

        executionThread = Thread.currentThread();
        // Rhino contexts are thread-affine; bind ours to this worker thread for the duration of the execution.
        // CC runs a given computer on one worker at a time, so the single `cx` is free between events.
        factory.enterContext(cx);
        try {
            if (!started) {
                started = true;
                try {
                    cx.executeScriptWithContinuations(biosScript, scope);
                } catch (ContinuationPending pending) {
                    eventLoop.schedule(pending);
                } catch (EvaluatorException e) {
                    return mapException(e);
                } catch (RhinoException e) {
                    close();
                    return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
                } catch (Exception e) {
                    close();
                    return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
                }
                // Fire __start__ so any os.on("__start__", cb) listeners run.
                var startResult = emitSafe("__start__", new Object[0]);
                if (!startResult.isError()) scheduleSelfTick();
                return startResult;
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

            // Phase 1 — Timers: wake up os.sleep() continuations whose CC timer just fired.
            if ("timer".equals(eventName) && rawArgs.length >= 1 && rawArgs[0] instanceof Number n) {
                var r = eventLoop.drainTimers(cx, scope, n.intValue());
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
            executionThread = null;
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

    /** Call emitter.emit(), routing any captured continuations into the event loop. */
    private MachineResult emitSafe(String event, Object[] jsArgs) {
        try {
            emitter.emit(cx, scope, event, jsArgs);
        } catch (MultiContinuationPending multi) {
            for (var p : multi.continuations()) eventLoop.schedule(p);
        } catch (EvaluatorException e) {
            return mapException(e);
        } catch (RhinoException e) {
            close();
            return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
        } catch (Exception e) {
            close();
            return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
        }
        return MachineResult.OK;
    }

    private MachineResult mapException(EvaluatorException e) {
        var msg = e.getMessage();
        if (HARD_ABORT_MESSAGE.equals(msg)) {
            close();
            return MachineResult.TIMEOUT;
        }
        if (TimeoutState.ABORT_MESSAGE.equals(msg)) {
            close();
            return MachineResult.error(TimeoutState.ABORT_MESSAGE);
        }
        close();
        return MachineResult.error(msg != null ? msg : e.toString());
    }

    @Override
    public void printExecutionState(StringBuilder out) {
    }

    @Override
    public void close() {
        if (isDisposed) return;
        isDisposed = true;
        eventLoop.clear();
        var listener = abortListener;
        if (listener != null) {
            timeout.removeListener(listener);
            abortListener = null;
        }
        // The context is entered/exited per execution (constructor + handleEvent), not held open across the
        // machine's lifetime, so there is nothing to exit here — and close() may run on a thread that never
        // entered it.
    }

    private final class CCContextFactory extends ContextFactory {
        @Override
        @SuppressWarnings("deprecation") // setOptimizationLevel(-1) = interpreter mode; required for continuations
        protected Context makeContext() {
            var cx = super.makeContext();
            cx.setOptimizationLevel(-1);
            cx.setLanguageVersion(Context.VERSION_ES6);
            cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold);
            // Interpreter frames live on the heap, so unbounded recursion would otherwise eat memory until timeout.
            cx.setMaximumInterpreterStackDepth(CoreConfig.jsMaxStackDepth);
            cx.setClassShutter(className -> false);
            return cx;
        }

        @Override
        protected void observeInstructionCount(Context cx, int instructionCount) {
            if (isDisposed || timeout.isHardAborted()) {
                throw new EvaluatorException(HARD_ABORT_MESSAGE);
            }
            if (timeout.isSoftAborted()) {
                throw new EvaluatorException(TimeoutState.ABORT_MESSAGE);
            }
            while (timeout.isPaused()) {
                executionThread = Thread.currentThread();
                if (isDisposed || timeout.isHardAborted()) {
                    throw new EvaluatorException(HARD_ABORT_MESSAGE);
                }
                LockSupport.parkNanos(1_000_000L); // 1 ms; listener unparks on hard abort
            }
            executionThread = null;
        }
    }
}
