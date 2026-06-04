// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.ILuaAPI;
import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.MethodResult;
import dan200.computercraft.core.CoreConfig;
import dan200.computercraft.core.computer.TimeoutState;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.HostAccess;
import org.graalvm.polyglot.PolyglotException;
import org.graalvm.polyglot.ResourceLimitEvent;
import org.graalvm.polyglot.ResourceLimits;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;
import org.graalvm.polyglot.io.IOAccess;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.locks.LockSupport;

/**
 * A JavaScript-based machine implementation using GraalJS.
 * Replaces {@link CobaltLuaMachine} with an ES6 JavaScript engine.
 */
public class JSMachine implements ILuaMachine, AutoCloseable {
    private static final Logger LOG = LoggerFactory.getLogger(JSMachine.class);

    private static final Engine SHARED_ENGINE = Engine.newBuilder("js")
        .option("engine.WarnInterpreterOnly", "false")
        .build();

    /** Minimal Node.js-compatible EventEmitter, evaluated once per context. */
    private static final String EMITTER_JS = """
        class EventEmitter {
            constructor() { this._listeners = {}; }
            on(event, fn) { (this._listeners[event] ??= []).push({ fn, once: false }); return this; }
            once(event, fn) { (this._listeners[event] ??= []).push({ fn, once: true }); return this; }
            off(event, fn) {
                const ls = this._listeners[event];
                if (ls) this._listeners[event] = ls.filter(l => l.fn !== fn);
                return this;
            }
            emit(event, ...args) {
                const ls = this._listeners[event];
                if (!ls || ls.length === 0) return false;
                const snapshot = [...ls];
                this._listeners[event] = ls.filter(l => !l.once);
                for (const l of snapshot) l.fn(...args);
                return true;
            }
            listenerCount(event) { return (this._listeners[event] ?? []).length; }
        }
        globalThis.EventEmitter = EventEmitter;
        globalThis.__emitter__ = new EventEmitter();
        globalThis.__createPromise__ = cb => new Promise(cb);
        """;

    // -------------------------------------------------------------------------
    // Pending callback: stores state for a method that returned MethodResult.pullEvent()
    // -------------------------------------------------------------------------

    /**
     * Active callback chain waiting for a CC event.
     * When the right event arrives, we invoke the callback and resolve/reject the JS Promise.
     */
    record PendingCallback(
        @Nullable String filter,  // CC event name filter (null = any event)
        dan200.computercraft.api.lua.ILuaCallback callback,
        Value resolve,            // JS Promise resolve fn
        Value reject              // JS Promise reject fn
    ) {}

    // -------------------------------------------------------------------------
    // Fields
    // -------------------------------------------------------------------------

    private final TimeoutState timeout;
    private final Runnable timeoutListener = this::onTimeoutChanged;
    private final ILuaContext luaContext;

    private final Context context;
    private final Value emitter;
    private final Value createPromiseFn;
    private @Nullable Source biosSource;

    private volatile boolean isDisposed = false;
    private boolean biosExecuted = false;

    private @Nullable PendingCallback pendingCallback = null;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    public JSMachine(MachineEnvironment environment, InputStream bios) throws MachineException {
        timeout    = environment.timeout();
        luaContext = environment.context();

        var limits = ResourceLimits.newBuilder()
            .statementLimit(CoreConfig.jsStatementLimit, null)
            .onLimit(this::safepoint)
            .build();

        // Wire CC filesystem for ES6 module resolution (null in tests — falls back to deny-all)
        var ioAccess = environment.fileSystem() != null
            ? JSFileSystem.ioAccess(environment.fileSystem())
            : IOAccess.NONE;

        context = Context.newBuilder("js")
            .engine(SHARED_ENGINE)
            .resourceLimits(limits)
            // Host object access: ALL so that IDynamicLuaObject / ILuaFunction return values
            // remain callable. Class *lookup* is disabled separately so Java.type() is blocked.
            .allowHostAccess(HostAccess.ALL)
            .allowHostClassLookup(className -> false)  // blocks Java.type(), Packages.*, etc.
            .allowCreateThread(false)
            .allowNativeAccess(false)
            .allowExperimentalOptions(true)
            .allowIO(ioAccess)
            .option("js.esm-eval-returns-exports", "true")
            .build();

        // Boot EventEmitter and Promise factory
        context.eval("js", EMITTER_JS);
        var bindings = context.getBindings("js");
        emitter          = bindings.getMember("__emitter__");
        createPromiseFn  = bindings.getMember("__createPromise__");

        for (var api : environment.apis()) {
            var proxy = JSAPIBuilder.build(api, environment.luaMethods(), luaContext, this);
            for (var name : api.getNames()) bindings.putMember(name, proxy);

            var moduleName = api.getModuleName();
            if (moduleName != null) bindings.putMember(moduleName, proxy);
        }

        // Augment the os proxy (now already registered) with event routing.
        // ProxyObject.fromMap() is backed by a mutable LinkedHashMap so putMember works.
        context.eval("js", """
            globalThis.os = globalThis.os ?? {};
            os.on   = (event, fn) => __emitter__.on(event, fn);
            os.once = (event, fn) => __emitter__.once(event, fn);
            os.off  = (event, fn) => __emitter__.off(event, fn);
            """);

        try {
            var reader = new InputStreamReader(bios, StandardCharsets.UTF_8);
            biosSource = Source.newBuilder("js", reader, "bios.js").build();
        } catch (IOException e) {
            throw new MachineException("Failed to read bios.js: " + e.getMessage());
        }

        timeout.addListener(timeoutListener);
    }

    // -------------------------------------------------------------------------
    // Package-visible accessors for JSMethodBridge / JSAPIBuilder
    // -------------------------------------------------------------------------

    Context context() { return context; }

    Value createPromiseFn() { return createPromiseFn; }

    void setPendingCallback(PendingCallback pending) { this.pendingCallback = pending; }

    // -------------------------------------------------------------------------
    // Safepoint & timeout
    // -------------------------------------------------------------------------

    private void safepoint(ResourceLimitEvent event) {
        if (isDisposed || timeout.isHardAborted()) return;
        if (timeout.isSoftAborted()) return;
        while (timeout.isPaused() && !timeout.isHardAborted() && !isDisposed) {
            LockSupport.parkNanos(1_000_000L);
        }
        event.getContext().resetLimits();
    }

    private void onTimeoutChanged() {
        if (isDisposed) return;
        if (timeout.isHardAborted()) {
            try {
                context.interrupt(java.time.Duration.ofMillis(10));
            } catch (TimeoutException e) {
                // Expected: signal sent, will be seen at next safepoint
            }
        }
    }

    // -------------------------------------------------------------------------
    // ILuaMachine
    // -------------------------------------------------------------------------

    @Override
    public MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        if (isDisposed) throw new IllegalStateException("Machine has been closed");

        // Startup: run bios then fire __start__
        if (!biosExecuted) {
            biosExecuted = true;
            var src = biosSource;
            biosSource = null;
            if (src != null) {
                var r = evalSafe(src);
                if (r != null) return r;
            }
            return dispatchEvent("__start__", null);
        }

        // Resolve any pending pullEvent callback before dispatching to the EventEmitter
        if (eventName != null) {
            var r = tryResolvePending(eventName, arguments);
            if (r != null) return r;
        }

        return dispatchEvent(eventName, arguments);
    }

    /**
     * If there is a pending {@link PendingCallback} whose filter matches {@code eventName},
     * invoke its callback, resolve/reject the Promise, and return a result.
     * Returns {@code null} if there was no match (caller should continue with normal dispatch).
     */
    private @Nullable MachineResult tryResolvePending(String eventName, @Nullable Object @Nullable [] args) {
        var pending = pendingCallback;
        if (pending == null) return null;

        // Filter: null means any event; "terminate" always passes through
        if (pending.filter() != null && !pending.filter().equals(eventName) && !eventName.equals("terminate")) {
            return null; // no match — keep waiting
        }

        pendingCallback = null; // clear before invoking (re-entrancy guard)

        // Build resume args: [eventName, arg0, arg1, ...]
        int argLen = args != null ? args.length : 0;
        var resumeArgs = new Object[1 + argLen];
        resumeArgs[0] = eventName;
        if (args != null) System.arraycopy(args, 0, resumeArgs, 1, argLen);

        try {
            var result = pending.callback().resume(resumeArgs);
            return resolveResult(result, pending.resolve(), pending.reject());
        } catch (LuaException e) {
            pending.reject().execute(e.getMessage());
            flushMicrotasks();
            return MachineResult.OK;
        } catch (PolyglotException e) {
            return mapException(e);
        }
    }

    /**
     * Deliver a {@link MethodResult} to the JS side: either resolve the Promise (final result)
     * or update the pending callback (still waiting for another event).
     */
    private MachineResult resolveResult(MethodResult result, Value resolve, Value reject) {
        if (result.getCallback() == null) {
            // Final result — resolve the Promise
            try {
                resolve.execute(JSValues.resultToJs(context, result.getResult()));
                flushMicrotasks();
            } catch (PolyglotException e) {
                return mapException(e);
            }
            return MachineResult.OK;
        }

        // Still waiting for another event — chain the callback
        var filter = extractFilter(result);
        pendingCallback = new PendingCallback(filter, result.getCallback(), resolve, reject);
        return MachineResult.OK;
    }

    /** Extracts the event-name filter from the first element of a MethodResult's result array. */
    private static @Nullable String extractFilter(MethodResult result) {
        var vals = result.getResult();
        if (vals != null && vals.length > 0 && vals[0] instanceof String s) return s;
        return null;
    }

    // -------------------------------------------------------------------------
    // EventEmitter dispatch
    // -------------------------------------------------------------------------

    private MachineResult dispatchEvent(@Nullable String eventName, @Nullable Object @Nullable [] args) {
        if (eventName == null) return MachineResult.OK;

        try {
            var jsArgs = buildArgs(eventName, args);
            emitter.getMember("emit").execute((Object[]) jsArgs);
            flushMicrotasks();
            return MachineResult.OK;
        } catch (PolyglotException e) {
            return mapException(e);
        }
    }

    private Value[] buildArgs(String eventName, @Nullable Object @Nullable [] args) {
        if (args == null || args.length == 0) return new Value[]{ context.asValue(eventName) };
        var result = new Value[1 + args.length];
        result[0] = context.asValue(eventName);
        for (int i = 0; i < args.length; i++) result[i + 1] = JSValues.toJs(context, args[i]);
        return result;
    }

    private void flushMicrotasks() {
        try {
            context.eval("js", "(async()=>{})()");
        } catch (PolyglotException ignored) {
        }
    }

    // -------------------------------------------------------------------------
    // Error mapping
    // -------------------------------------------------------------------------

    private @Nullable MachineResult evalSafe(Source src) {
        try {
            context.eval(src);
            return null;
        } catch (PolyglotException e) {
            return mapException(e);
        }
    }

    private MachineResult mapException(PolyglotException e) {
        if (e.isResourceExhausted()) {
            close();
            if (timeout.isHardAborted() || isDisposed) return MachineResult.TIMEOUT;
            if (timeout.isSoftAborted()) return MachineResult.error(TimeoutState.ABORT_MESSAGE);
            return MachineResult.GENERIC_ERROR;
        }
        if (e.isInterrupted() || e.isCancelled()) {
            close();
            return MachineResult.TIMEOUT;
        }
        close();
        var msg = e.getMessage();
        LOG.warn("JS error in computer: {}", msg);
        return MachineResult.error(msg != null ? msg : "Unknown JS error");
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    @Override
    public void printExecutionState(StringBuilder out) {
        out.append("JSMachine: isDisposed=").append(isDisposed)
            .append(", biosExecuted=").append(biosExecuted)
            .append(", pendingCallback=").append(pendingCallback != null ? pendingCallback.filter() : "none")
            .append('\n');
    }

    @Override
    public void close() {
        if (isDisposed) return;
        isDisposed = true;
        timeout.removeListener(timeoutListener);
        try {
            context.close(true);
        } catch (Exception e) {
            LOG.debug("Exception while closing JS context", e);
        }
    }
}
