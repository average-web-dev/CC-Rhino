// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.CoreConfig;
import dan200.computercraft.core.computer.TimeoutState;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.locks.LockSupport;

public class JSMachine implements IMachine {
    private static final String HARD_ABORT_MESSAGE = "hard abort";

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

    // Pending Rhino continuations — one entry per blocked listener (e.g. each os.on() callback
    // that called a blocking API). Application state on each entry is the MethodResult carrying
    // the event filter and ICallback. Cleared on close().
    private final List<ContinuationPending> pendingContinuations = new ArrayList<>();

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

        // Build the module loader and register all CC APIs as native modules.
        var loader = new JSRequire(scope, environment.fileSystem());
        var context = environment.context();
        var methods = environment.luaMethods();
        for (var api : environment.apis()) {
            for (var name : api.getNames()) {
                var obj = JSAPIBuilder.build(cx, scope, api, context, methods);
                if ("os".equals(name)) {
                    addEmitterMethods(obj);
                }
                loader.registerNative(name, obj);
            }
        }

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

    /** Attach on/once/off/listenerCount to the given object, backed by this machine's emitter. */
    private void addEmitterMethods(Scriptable obj) {
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
                    pendingContinuations.add(pending);
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

            // Resume any pending blocking continuations whose event filter matches.
            if (!pendingContinuations.isEmpty()) {
                var contResult = resumePending(eventName, arguments);
                if (contResult.isError()) return contResult;
            }

            // Dispatch to os.on() listeners regardless of whether a continuation is pending.
            var jsArgs = toJsArgs(arguments);
            return emitSafe(eventName, jsArgs);

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

    /** Call emitter.emit(), mapping any Rhino exceptions to MachineResult. */
    private MachineResult emitSafe(String event, Object[] jsArgs) {
        try {
            emitter.emit(cx, scope, event, jsArgs);
        } catch (MultiContinuationPending multi) {
            // One or more os.on() callbacks made a blocking call — add them all to the pending list.
            pendingContinuations.addAll(multi.continuations());
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

    /**
     * Walk every pending continuation. For each one whose event filter matches {@code eventName},
     * drive its callback chain. If the chain resolves, resume the Rhino continuation with the
     * result (which may itself yield again, adding a new entry). Continuations whose filter does
     * not match are left untouched for the next event.
     */
    private MachineResult resumePending(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        var args = arguments != null ? arguments : new Object[0];
        var fullArgs = new Object[args.length + 1];
        fullArgs[0] = eventName;
        System.arraycopy(args, 0, fullArgs, 1, args.length);

        // Snapshot and clear so that resumeContinuation() can safely append new entries
        // without causing a ConcurrentModificationException.
        var snapshot = new ArrayList<>(pendingContinuations);
        pendingContinuations.clear();

        for (var pending : snapshot) {
            var mr = (MethodResult) pending.getApplicationState();

            // Check event filter — null filter accepts any event.
            var filterResult = mr.getResult();
            @Nullable String filter = filterResult != null && filterResult.length > 0 && filterResult[0] instanceof String s
                ? s : null;
            if (filter != null && !filter.equals(eventName)) {
                pendingContinuations.add(pending); // keep for a future event
                continue;
            }

            var callback = mr.getCallback();
            if (callback == null) continue; // no callback — discard

            try {
                var newMr = callback.resume(fullArgs);
                if (newMr.getCallback() == null) {
                    // Callback chain complete — resume the stored JS continuation.
                    var jsResult = JSValues.toJsResult(cx, scope, newMr.getResult());
                    var contResult = resumeContinuation(pending, jsResult);
                    if (contResult.isError()) return contResult;
                } else {
                    // Still waiting for another event — put back with updated app state.
                    pending.setApplicationState(newMr);
                    pendingContinuations.add(pending);
                }
            } catch (ScriptException e) {
                var msg = e.getMessage();
                close();
                return MachineResult.error(msg != null ? msg : e.toString());
            }
        }
        return MachineResult.OK;
    }

    /**
     * Resume a single Rhino continuation with {@code jsResult}. If the resumed code yields again
     * (another blocking call), the new continuation is appended to {@link #pendingContinuations}.
     */
    private MachineResult resumeContinuation(ContinuationPending pending, Object jsResult) {
        try {
            cx.resumeContinuation(pending.getContinuation(), scope, jsResult);
        } catch (ContinuationPending newPending) {
            pendingContinuations.add(newPending);
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
        pendingContinuations.clear();
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
