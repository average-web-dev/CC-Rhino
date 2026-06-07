// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.engine.EventLoop;
import dan200.computercraft.core.engine.JSEventEmitter;
import org.mozilla.javascript.Callable;

/**
 * The {@code events} native module — {@code require('events')}.
 *
 * <p>Provides Node.js-style event-emitter and task-scheduler primitives:
 * {@code on/once/off/listenerCount}, {@code queueMicrotask}, {@code setImmediate}/{@code clearImmediate}.
 *
 * <p>Callback parameters are typed as {@code Object} so the annotation processor extracts them via
 * {@link dan200.computercraft.core.engine.JSArguments#get}, which passes Rhino {@link Callable}
 * instances through without nulling them out (see {@code JSValues.toJava}).
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

    @ScriptFunction
    public void on(String event, Object callback) {
        if (callback instanceof Callable fn) emitter.on(event, fn);
    }

    @ScriptFunction
    public void once(String event, Object callback) {
        if (callback instanceof Callable fn) emitter.once(event, fn);
    }

    @ScriptFunction
    public void off(String event, Object callback) {
        if (callback instanceof Callable fn) emitter.off(event, fn);
    }

    @ScriptFunction
    public int listenerCount(String event) {
        return emitter.listenerCount(event);
    }

    @ScriptFunction
    public void queueMicrotask(Object callback) {
        if (callback instanceof Callable fn) eventLoop.scheduleMicrotask(fn);
    }

    @ScriptFunction
    public int setImmediate(Object callback) {
        return callback instanceof Callable fn ? eventLoop.scheduleImmediate(fn) : -1;
    }

    @ScriptFunction
    public void clearImmediate(int id) {
        eventLoop.cancelImmediate(id);
    }
}
