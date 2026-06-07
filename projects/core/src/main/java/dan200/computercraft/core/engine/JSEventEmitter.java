// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ContinuationPending;
import org.mozilla.javascript.Scriptable;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure-Java event listener registry for the JS machine.
 *
 * <p>Exposed to JS via the {@code events} native module ({@code on/once/off/listenerCount}).
 * All listener invocations happen synchronously inside {@link #emit}.
*/
public final class JSEventEmitter {
    record ListenerEntry(Callable fn, boolean once) {}

    private final Map<String, List<ListenerEntry>> listeners = new HashMap<>();

    public void on(String event, Callable fn) {
        listeners.computeIfAbsent(event, k -> new ArrayList<>()).add(new ListenerEntry(fn, false));
    }

    public void once(String event, Callable fn) {
        listeners.computeIfAbsent(event, k -> new ArrayList<>()).add(new ListenerEntry(fn, true));
    }

    public void off(String event, Callable fn) {
        var list = listeners.get(event);
        if (list != null) list.removeIf(e -> e.fn() == fn);
    }

    /**
     * Invoke all listeners registered for {@code event}.
     * {@code once} listeners are removed before invocation so they can't be called twice even if
     * a listener re-registers during emission.
     */
    public void emit(Context cx, Scriptable scope, String event, Object[] jsArgs) {
        var list = listeners.get(event);
        if (list == null || list.isEmpty()) return;
        var snapshot = new ArrayList<>(list);
        list.removeIf(ListenerEntry::once);
        // Run every listener even if an earlier one captures a continuation (blocking call).
        // Collecting all continuations in a list lets non-blocking listeners always execute.
        List<ContinuationPending> captured = null;
        for (var entry : snapshot) {
            try {
                cx.callFunctionWithContinuations(entry.fn(), scope, jsArgs);
            } catch (ContinuationPending pending) {
                if (captured == null) captured = new ArrayList<>();
                captured.add(pending);
            }
        }
        if (captured != null) throw new MultiContinuationPending(captured);
    }

    public int listenerCount(String event) {
        var list = listeners.get(event);
        return list == null ? 0 : list.size();
    }
}
