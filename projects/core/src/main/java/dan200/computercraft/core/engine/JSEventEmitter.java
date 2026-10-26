// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.Events;
import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.apis.events.CharEvent;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.apis.events.KeyEvent;
import dan200.computercraft.core.apis.events.RedstoneEvent;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.BaseFunction;
import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.JavaScriptException;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The event bus of a JS machine: the registry of {@code events.on} listeners, and the single place events are
 * delivered to them.
 *
 * <p>Exposed to JS via the {@code events} native module ({@code on/once/off/listenerCount/emit}). Every listener is
 * owned by the green thread that registered it (see {@link JSThread}): listeners of a killed thread are removed, so a
 * stopped or terminated program stops reacting to events.
 *
 * <p>Events reach the listeners in one of two ways:
 * <ul>
 *   <li><strong>Queued</strong> — {@code queueEvent} on the computer, from any thread. The event is delivered on a
 *   later tick by {@code JSMachine.handleEvent}: it wakes blocked calls waiting for it, then runs the listeners
 *   ({@link EventLoop#emit}), each of which may block.</li>
 *   <li><strong>Synchronous</strong> — {@code events.emit} from JS, and {@link #fireNow} from Java code running inside
 *   this machine's JS execution (e.g. a script method). The listeners run straight away, before the call returns.
 *   Blocked calls waiting for the event are not woken.
 *   <ul>
 *     <li>{@code events.emit} is JS ({@link #installEmit}): it calls the listeners of the calling thread and its
 *     ancestors itself, so they may block, which blocks the caller of {@code emit}. Listeners of other threads are
 *     called from Java as their owner (see {@link EventLoop#emitPlan}) and cannot block.</li>
 *     <li>{@link #fireNow} and {@code events/promises.emit} call every listener from Java
 *     ({@link EventLoop#dispatchNow}); like callbacks of {@code Array.prototype.forEach}, none of them can block.</li>
 *   </ul></li>
 * </ul>
 */
public final class JSEventEmitter {
    record ListenerEntry(Callable fn, boolean once, JSThread owner) {}

    private static final Object KEY = JSEventEmitter.class;

    /** The {@code Error.code} of the error {@code events.emit} throws for a native event. */
    static final String RESERVED_CODE = "ERR_RESERVED_EVENT";

    /** Events the engine emits itself, without a record. */
    static final String START_EVENT = "__start__";
    static final String SELF_TICK_EVENT = "cc:js-tick";

    static {
        // The core runtime's events. Other modules register theirs (e.g. PeripheralEvents) at startup.
        Events.register(CoreEvents.class, KeyEvent.class, CharEvent.class, RedstoneEvent.class);
        Events.registerNames(START_EVENT, SELF_TICK_EVENT);
    }

    private final EventLoop eventLoop;
    private final Map<String, List<ListenerEntry>> listeners = new HashMap<>();
    private @Nullable Scriptable scope;

    JSEventEmitter(EventLoop eventLoop) {
        this.eventLoop = eventLoop;
    }

    /** Attach this emitter to its machine's context, so Java code running in the machine finds it ({@link #current}). */
    void install(Context cx, Scriptable scope) {
        this.scope = scope;
        cx.putThreadLocal(KEY, this);
    }

    /**
     * The emitter of the JS machine whose code is executing on this thread — e.g. inside a script method called from
     * JS.
     *
     * @return The current machine's emitter.
     * @throws IllegalStateException If no JS machine is executing on this thread. Code running outside the machine
     *                               (the server thread, network threads, …) must queue events instead.
     */
    public static JSEventEmitter current() {
        var cx = Context.getCurrentContext();
        var emitter = cx == null ? null : (JSEventEmitter) cx.getThreadLocal(KEY);
        if (emitter == null) {
            throw new IllegalStateException("No JS machine is executing on this thread; queue the event instead");
        }
        return emitter;
    }

    /**
     * Deliver an {@link dan200.computercraft.api.scripting.Event @Event} record to the {@code events.on} listeners
     * synchronously, before this method returns. Only for Java code already running inside this machine's JS
     * execution (see {@link #current()}); anything else must queue the event.
     *
     * <p>Listeners run as in normal dispatch: each as the thread that registered it, listeners of stopped threads are
     * skipped, and an error fails the listener's thread. An error in a listener owned by the calling thread (or one of
     * its ancestors) is thrown from here instead, so it reaches the JS caller — which fails that thread if uncaught.
     * Unlike a queued event, blocked calls waiting for the event are not woken, and the listeners cannot block.
     *
     * @param event The event record.
     * @return Whether the event had any listeners.
     * @throws IllegalStateException If this machine is not executing on this thread.
     */
    public boolean fireNow(Record event) {
        var cx = Context.getCurrentContext();
        var scope = this.scope;
        if (cx == null || cx.getThreadLocal(KEY) != this || scope == null) {
            throw new IllegalStateException("This JS machine is not executing on this thread; queue the event instead");
        }
        return fireNow(cx, scope, event);
    }

    /**
     * {@link #fireNow(Record)} with an explicit context and scope.
     *
     * @param cx    The machine's context, entered on this thread.
     * @param scope The machine's global scope.
     * @param event The event record.
     * @return Whether the event had any listeners.
     */
    public boolean fireNow(Context cx, Scriptable scope, Record event) {
        var args = Events.arguments(event);
        var jsArgs = new Object[args.length];
        for (var i = 0; i < args.length; i++) jsArgs[i] = JSValues.toJs(cx, scope, args[i]);
        return eventLoop.dispatchNow(cx, scope, Events.name(event), jsArgs);
    }

    /**
     * The {@code events/promises} flavour of {@code events.emit} (the blocking module's {@code emit} is the JS function
     * installed by {@link #installEmit}). It calls every listener through {@link EventLoop#dispatchNow}, so none of
     * them can block, and its promise is settled once they have all run.
     *
     * @param arguments {@code (event, ...args)}, as passed from JS.
     * @return Whether the event had any listeners.
     * @throws ScriptException If {@code event} is a native event (see {@link Events#isNative}).
     */
    public boolean emit(IArguments arguments) throws ScriptException {
        var event = checkEmittable(arguments.getString(0));
        var cx = Context.getCurrentContext();
        var scope = this.scope;
        if (cx == null || scope == null) throw new IllegalStateException("No JS machine is executing on this thread");

        Object[] jsArgs;
        if (arguments instanceof JSArguments js) {
            jsArgs = js.raw(1);
        } else {
            var rest = arguments.drop(1).getAll();
            jsArgs = new Object[rest.length];
            for (var i = 0; i < rest.length; i++) jsArgs[i] = JSValues.toJs(cx, scope, rest[i]);
        }
        return eventLoop.dispatchNow(cx, scope, event, jsArgs);
    }

    /** Scripts may emit any event but a native one (see {@link Events#isNative}). */
    private static String checkEmittable(String event) throws ScriptException {
        if (Events.isNative(event)) {
            throw new ScriptException(
                "Cannot emit '" + event + "': it is a native event, only the computer can fire it",
                Map.of("code", RESERVED_CODE)
            );
        }
        return event;
    }

    /**
     * {@code events.emit(event, ...args)}, in JS so that the listeners it calls may block. Rhino can only capture a
     * continuation across interpreted frames: this function calls the listeners itself ({@code apply} of an
     * interpreted function stays in the interpreter), so a blocking call in a listener parks the caller of
     * {@code emit}, and {@code emit} returns once the listeners have finished. {@code plan(event)} is {@link EmitPlan}.
     */
    private static final String EMIT_JS = """
        (function (plan) {
            return function emit(event) {
                var args = [];
                for (var j = 1; j < arguments.length; j++) args[j - 1] = arguments[j];
                var listeners = plan(event);
                for (var i = 0; i < listeners.length; i++) listeners[i].apply(undefined, args);
                return listeners.length > 0;
            };
        })
        """;

    /**
     * Replace the {@code emit} of the blocking {@code events} module (built from {@code EventsAPI}) with the JS
     * implementation ({@link #EMIT_JS}). The {@code @ScriptFunction} still provides the TypeScript declaration and
     * the {@code events/promises} flavour.
     */
    void installEmit(Context cx, Scriptable scope, Scriptable module) {
        var plan = new EmitPlan();
        ScriptRuntime.setFunctionProtoAndParent(plan, cx, scope);
        var factory = (Function) cx.evaluateString(scope, EMIT_JS, "events-emit.js", 1, null);
        ScriptableObject.putProperty(module, "emit", factory.call(cx, scope, scope, new Object[]{ plan }));
    }

    /**
     * {@code plan(event)} for {@link #EMIT_JS}: checks that the event may be emitted, and returns the functions to
     * call, in registration order (see {@link EventLoop#emitPlan}). Never blocks.
     */
    @SuppressWarnings("serial") // never serialized
    private final class EmitPlan extends BaseFunction {
        private static final long serialVersionUID = 1L;

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            String event;
            try {
                event = checkEmittable(new JSArguments(args).getString(0));
            } catch (ScriptException e) {
                throw new JavaScriptException(JSErrors.newError(cx, scope, e), "events-emit.js", 0);
            }
            return eventLoop.emitPlan(cx, scope, event);
        }
    }

    public void on(String event, Callable fn) {
        add(event, fn, false);
    }

    public void once(String event, Callable fn) {
        add(event, fn, true);
    }

    private void add(String event, Callable fn, boolean once) {
        listeners.computeIfAbsent(event, k -> new ArrayList<>()).add(new ListenerEntry(fn, once, eventLoop.currentThread()));
    }

    public void off(String event, Callable fn) {
        var list = listeners.get(event);
        if (list != null) list.removeIf(e -> e.fn() == fn);
    }

    /**
     * Take the listeners to invoke for {@code event}. {@code once} listeners are removed before invocation so they
     * can't be called twice even if a listener re-registers during emission.
     */
    List<ListenerEntry> take(String event) {
        var list = listeners.get(event);
        if (list == null || list.isEmpty()) return List.of();
        var snapshot = List.copyOf(list);
        list.removeIf(ListenerEntry::once);
        return snapshot;
    }

    /** Remove every listener whose owning thread has been killed. */
    void removeDead() {
        for (var list : listeners.values()) list.removeIf(e -> e.owner().isDead());
    }

    public int listenerCount(String event) {
        var list = listeners.get(event);
        return list == null ? 0 : list.size();
    }
}
