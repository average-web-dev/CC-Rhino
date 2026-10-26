// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.engine.EventLoop;
import dan200.computercraft.core.engine.JSEventEmitter;
import org.mozilla.javascript.Callable;

/**
 * The {@code events} native module — {@code require('events')}.
 *
 * <p>Provides Node.js-style event-emitter and task-scheduler primitives:
 * {@code on/once/off/emit/listenerCount}, {@code queueMicrotask}, {@code setImmediate}/{@code clearImmediate}.
 *
 * <p>Callback parameters are typed as {@code Object} so the annotation processor extracts them via
 * {@link dan200.computercraft.core.engine.JSArguments#get}, which passes Rhino {@link Callable}
 * instances through without nulling them out (see {@code JSValues.toJava}).
 * @cc.module events
 */
public final class EventsAPI implements IComputerAPI {
    private final JSEventEmitter emitter;
    private final EventLoop eventLoop;

    public EventsAPI(JSEventEmitter emitter, EventLoop eventLoop) {
        this.emitter = emitter;
        this.eventLoop = eventLoop;
    }

    @Override
    public String[] getNames() {
        return new String[]{ "events" };
    }

    /**
     * Register a listener invoked every time {@code event} is fired.
     *
     * @cc-r.eventlistener
     */
    @ScriptFunction
    public void on(String event, Object callback) {
        if (callback instanceof Callable fn) emitter.on(event, fn);
    }

    /**
     * Register a listener invoked the next time {@code event} is fired, then removed.
     *
     * @cc-r.eventlistener
     */
    @ScriptFunction
    public void once(String event, Object callback) {
        if (callback instanceof Callable fn) emitter.once(event, fn);
    }

    /**
     * Remove a previously registered listener for {@code event}.
     *
     * @cc-r.eventlistener
     */
    @ScriptFunction
    public void off(String event, Object callback) {
        if (callback instanceof Callable fn) emitter.off(event, fn);
    }

    /**
     * The number of listeners currently registered for {@code event}.
     *
     * @param event The event name.
     * @return How many listeners would run if the event fired now.
     */
    @ScriptFunction
    public int listenerCount(String event) {
        return emitter.listenerCount(event);
    }

    /**
     * Call every listener of {@code event} synchronously, in registration order, with {@code args}, like Node's
     * {@code EventEmitter.emit}.
     *
     * <p>Only script-defined events can be emitted: native events (those of {@code EventMap}, such as {@code key},
     * {@code timer} or {@code task_complete}) are fired by the computer alone, so a program cannot fake input or the
     * completion of another program's task. Declare the arguments of your own events by augmenting
     * {@code CustomEventMap}.
     *
     * <p>Listeners of the calling thread (or of a thread it belongs to, e.g. the program that started it) run as part
     * of the caller and may block, like any code of the caller: {@code emit} returns once they have finished. An error
     * they throw is thrown from {@code emit}, skipping the remaining listeners. Listeners of other threads (another
     * program) run as their own thread and cannot block; an error there fails that thread instead.
     *
     * <p>This is the blocking module's declaration only: the engine installs {@code emit} as a JS function, so that
     * listeners can block. In {@code events/promises}, {@code emit} calls every listener without letting it block and
     * returns a settled promise.
     *
     * @param args {@code (event, ...args)}.
     * @return Whether the event had any listeners.
     * @throws ScriptException If {@code event} is a native event ({@code code} {@code "ERR_RESERVED_EVENT"}).
     * @cc-r.overload {@code <E extends keyof CustomEventMap>(event: E, ...args: CustomEventMap[E]): boolean}
     * @cc-r.overload {@code <E extends string>(event: E extends keyof EventMap | keyof CustomEventMap ? never : E, ...args: any[]): boolean}
     */
    @ScriptFunction
    public boolean emit(IArguments args) throws ScriptException {
        return emitter.emit(args);
    }

    /**
     * Schedule a callback to run after the current operation completes, before the next event is handled.
     *
     * @param callback The function to run.
     * @cc-r.param callback {@code () => void}
     */
    @ScriptFunction
    public void queueMicrotask(Object callback) {
        if (callback instanceof Callable fn) eventLoop.scheduleMicrotask(fn);
    }

    /**
     * Schedule a callback to run on the next tick of the event loop.
     *
     * @param callback The function to run.
     * @return A handle which may be passed to {@link #clearImmediate} to cancel it.
     * @cc-r.param callback {@code () => void}
     */
    @ScriptFunction
    public int setImmediate(Object callback) {
        return callback instanceof Callable fn ? eventLoop.scheduleImmediate(fn) : -1;
    }

    /**
     * Cancel a callback scheduled with {@link #setImmediate}. Unknown or already-run handles are ignored.
     *
     * @param id The handle returned by {@link #setImmediate}.
     */
    @ScriptFunction
    public void clearImmediate(int id) {
        eventLoop.cancelImmediate(id);
    }
}
