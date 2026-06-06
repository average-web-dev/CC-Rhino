// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure-Java event listener registry for the JS machine.
 *
 * <p>Exposed to JS via the {@code os} native module ({@code on/once/off/listenerCount}).
 * All listener invocations happen synchronously inside {@link #emit}.
 */
final class JSEventEmitter {
    record ListenerEntry(Callable fn, boolean once) {}

    private final Map<String, List<ListenerEntry>> listeners = new HashMap<>();

    void on(String event, Callable fn) {
        listeners.computeIfAbsent(event, k -> new ArrayList<>()).add(new ListenerEntry(fn, false));
    }

    void once(String event, Callable fn) {
        listeners.computeIfAbsent(event, k -> new ArrayList<>()).add(new ListenerEntry(fn, true));
    }

    void off(String event, Callable fn) {
        var list = listeners.get(event);
        if (list != null) list.removeIf(e -> e.fn() == fn);
    }

    /**
     * Invoke all listeners registered for {@code event}.
     * {@code once} listeners are removed before invocation so they can't be called twice even if
     * a listener re-registers during emission.
     */
    void emit(Context cx, Scriptable scope, String event, Object[] jsArgs) {
        var list = listeners.get(event);
        if (list == null || list.isEmpty()) return;
        var snapshot = new ArrayList<>(list);
        list.removeIf(ListenerEntry::once);
        for (var entry : snapshot) {
            entry.fn().call(cx, scope, scope, jsArgs);
        }
    }

    int listenerCount(String event) {
        var list = listeners.get(event);
        return list == null ? 0 : list.size();
    }
}
