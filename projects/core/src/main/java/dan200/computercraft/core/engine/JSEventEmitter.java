// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.Callable;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure-Java event listener registry for the JS machine.
 *
 * <p>Exposed to JS via the {@code events} native module ({@code on/once/off/listenerCount}). Every listener is owned
 * by the green thread that registered it (see {@link JSThread}): listeners of a killed thread are removed, so a
 * stopped or terminated program stops reacting to events. Listeners are invoked by {@link EventLoop#emit}.
 */
public final class JSEventEmitter {
    record ListenerEntry(Callable fn, boolean once, JSThread owner) {}

    private final EventLoop eventLoop;
    private final Map<String, List<ListenerEntry>> listeners = new HashMap<>();

    JSEventEmitter(EventLoop eventLoop) {
        this.eventLoop = eventLoop;
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
