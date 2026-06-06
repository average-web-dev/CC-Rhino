// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.CoreConfig;
import dan200.computercraft.core.apis.OSAPI;
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
            function makeRequire(currentDir) {
                return function (id) {
                    var r = L.lookup(id, currentDir);
                    if (!r || typeof r !== 'object' || !r.__CC_LOAD__) return r;
                    var module = { exports: {}, id: r.resolved, filename: r.resolved };
                    (new Function('module', 'exports', 'require', '__filename', '__dirname', r.source))(
                        module, module.exports, makeRequire(r.dir), r.resolved, r.dir
                    );
                    L.setCache(r.resolved, module.exports);
                    return module.exports;
                };
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

    // Stored by observeInstructionCount so the abort listener can unpark this thread.
    private volatile @Nullable Thread executionThread;
    private @Nullable Runnable abortListener;

    // TODO: Phase 12 event loop — see JS_MIGRATION.md §Phase 12 for the full Node.js-style architecture.
    //   Currently continuations are bucketed by phase (timerMap / ioMap / microtaskQueue / checkMap)
    //   rather than kept in a flat list, giving O(1) lookup per event.
    private final EventLoop eventLoop = new EventLoop();

    private boolean started = false;
    private volatile boolean isDisposed = false;

    // Read the bios eagerly: ComputerExecutor closes the stream in a try-with-resources
    // immediately after construction, before handleEvent() is ever called.
    public JSMachine(MachineEnvironment environment, InputStream bios) throws IOException {
        var biosSource = new String(bios.readAllBytes(), StandardCharsets.UTF_8);
        timeout = environment.timeout();

        factory = new CCContextFactory();
        cx = factory.enterContext();
        scope = cx.initStandardObjects();

        // Strip all Java interop globals — classShutter already blocks class loading,
        // but removing these prevents enumeration and makes the intent explicit.
        for (var name : new String[]{
            "Packages", "java", "javax", "org", "com", "edu", "net",
            "JavaImporter", "importClass", "importPackage"
        }) {
            ScriptableObject.deleteProperty(scope, name);
        }

        // Compile bios now so we can use executeScriptWithContinuations later.
        biosScript = cx.compileString(biosSource, "bios.js", 1, null);

        emitter = new JSEventEmitter();

        // Find OSAPI — needed to schedule sleep timers directly into the event loop (Phase 12.3).
        OSAPI osApi = null;
        for (var api : environment.apis()) {
            if (api instanceof OSAPI osa) { osApi = osa; break; }
        }

        // Build the module loader and register all CC APIs as native modules.
        var loader = new JSRequire(scope, environment.fileSystem());
        var context = environment.context();
        var methods = environment.luaMethods();
        for (var api : environment.apis()) {
            for (var name : api.getNames()) {
                var obj = JSAPIBuilder.build(cx, scope, api, context, methods);
                if ("os".equals(name)) {
                    addOsMethods(obj, osApi);
                }
                loader.registerNative(name, obj);
            }
        }

        // Register event-loop globals (queueMicrotask, setImmediate, clearImmediate).
        addEventLoopGlobals();

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
    }

    /** Attach os event-emitter methods + sleep to the {@code os} native module object. */
    private void addOsMethods(Scriptable obj, @Nullable OSAPI osApi) {
        ScriptableObject.putProperty(obj, "on", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2 || !(args[1] instanceof Callable fn))
                    throw Context.reportRuntimeError("os.on(event, fn): fn must be a function");
                emitter.on(Context.toString(args[0]), fn);
                return Undefined.instance;
            }
        });
        ScriptableObject.putProperty(obj, "once", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2 || !(args[1] instanceof Callable fn))
                    throw Context.reportRuntimeError("os.once(event, fn): fn must be a function");
                emitter.once(Context.toString(args[0]), fn);
                return Undefined.instance;
            }
        });
        ScriptableObject.putProperty(obj, "off", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2 || !(args[1] instanceof Callable fn))
                    throw Context.reportRuntimeError("os.off(event, fn): fn must be a function");
                emitter.off(Context.toString(args[0]), fn);
                return Undefined.instance;
            }
        });
        ScriptableObject.putProperty(obj, "listenerCount", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return (double) emitter.listenerCount(Context.toString(args[0]));
            }
        });

        // sleep — Phase 12.3: captures a continuation directly into the timer map so Phase 1
        // resumes it in O(1) when the matching CC timer fires, without going through ioMap["timer"].
        if (osApi != null) {
            var capturedOsApi = osApi;
            ScriptableObject.putProperty(obj, "sleep", new BaseFunction() {
                @Override
                public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                    double seconds = args.length > 0 ? Context.toNumber(args[0]) : 0;
                    long ticks = Math.max(1L, Math.round(seconds / 0.05));
                    int timerId = capturedOsApi.startTimerForSleep(ticks);
                    var pending = cx.captureContinuation();
                    pending.setApplicationState(new EventLoop.SleepState(timerId));
                    throw pending;
                }
            });
        }
    }

    /** Register global event-loop functions: queueMicrotask, setImmediate, clearImmediate. */
    private void addEventLoopGlobals() {
        ScriptableObject.putProperty(scope, "queueMicrotask", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0 || !(args[0] instanceof Callable fn))
                    throw Context.reportRuntimeError("queueMicrotask(fn): fn must be a function");
                eventLoop.scheduleMicrotask(fn);
                return Undefined.instance;
            }
        });
        ScriptableObject.putProperty(scope, "setImmediate", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0 || !(args[0] instanceof Callable fn))
                    throw Context.reportRuntimeError("setImmediate(fn): fn must be a function");
                return (double) eventLoop.scheduleImmediate(fn);
            }
        });
        ScriptableObject.putProperty(scope, "clearImmediate", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length > 0 && args[0] instanceof Number n)
                    eventLoop.cancelImmediate(n.intValue());
                return Undefined.instance;
            }
        });
    }

    @Override
    public MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        if (isDisposed) return MachineResult.OK;

        executionThread = Thread.currentThread();
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
                return emitSafe("__start__", new Object[0]);
            }

            // Null event after startup is a no-op (Phase 5.4).
            if (eventName == null) return MachineResult.OK;

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

            // Phase 4 — Check: run setImmediate callbacks (+ Phase 3 microtasks).
            var r4 = eventLoop.drainCheck(cx, scope);
            if (r4.isError()) { close(); return r4; }

            return MachineResult.OK;

        } finally {
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
        Context.exit();
    }

    private final class CCContextFactory extends ContextFactory {
        @Override
        @SuppressWarnings("deprecation") // setOptimizationLevel(-1) = interpreter mode; required for continuations
        protected Context makeContext() {
            var cx = super.makeContext();
            cx.setOptimizationLevel(-1);
            cx.setLanguageVersion(Context.VERSION_ES6);
            cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold);
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
