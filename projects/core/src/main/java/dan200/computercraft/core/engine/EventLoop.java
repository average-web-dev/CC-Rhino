// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.computer.TimeoutState;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.util.*;

/**
 * Node.js-inspired four-phase event loop for the JS runtime.
 *
 * <ul>
 *   <li>Phase 1 — Timers: resumes {@code os.sleep()} continuations whose CC timer fires.</li>
 *   <li>Phase 2 — I/O: resumes continuations waiting for a specific CC event (turtle ops, modem, etc.).</li>
 *   <li>Phase 3 — Microtasks: drains {@code queueMicrotask()} callbacks after each phase.</li>
 *   <li>Phase 4 — Yields: resumes {@code os.yield()} continuations (snapshot-clear, one pass per tick).</li>
 *   <li>Phase 5 — Check: runs {@code setImmediate()} callbacks.</li>
 * </ul>
 *
 * <p>Each continuation is stored in the bucket matching its phase rather than a flat list.
 * This lets Phase 1 find expired timers in O(1) and Phase 2 find event-matched continuations in O(1)
 * instead of scanning the whole list on every event.
 *
 * @see JSMachine
 */
public final class EventLoop {

    private record IOEntry(ContinuationPending pending, MethodResult mr) {}

    // Phase 1 — timer ID → sleep continuation
    private final Map<Integer, ContinuationPending> timerMap = new HashMap<>();

    // Phase 2 — event filter → pending I/O continuations (null key = wildcard, accepts any event)
    private final Map<@Nullable String, List<IOEntry>> ioMap = new HashMap<>();

    // Phase 3 — yield continuations (os.yield); drained before JS microtasks, snapshot-clear per pass
    private final ArrayDeque<ContinuationPending> pendingYields = new ArrayDeque<>();

    // Phase 3 — JS microtask callbacks (queueMicrotask)
    private final ArrayDeque<Callable> microtaskQueue = new ArrayDeque<>();

    // Phase 4 — setImmediate callbacks (LinkedHashMap keeps insertion order so clearImmediate by ID works)
    private final LinkedHashMap<Integer, Callable> checkMap = new LinkedHashMap<>();
    private int nextCheckId = 0;

    // ------------------------------------------------------------------ scheduling

    /**
     * Route a freshly-caught {@link ContinuationPending} into the correct phase bucket.
     * The {@link MethodResult#getDestination()} field encodes which bucket to use:
     * TIMER → Phase 1; YIELD → Phase 4; null → Phase 2 I/O.
     */
    void schedule(ContinuationPending pending) {
        if (!(pending.getApplicationState() instanceof MethodResult mr)) return;
        switch (mr.getDestination()) {
            case TIMER -> {
                var r = mr.getResult();
                if (r != null && r.length > 0 && r[0] instanceof Number n) timerMap.put(n.intValue(), pending);
            }
            case YIELD -> pendingYields.add(pending);
            case IO -> ioMap.computeIfAbsent(filterOf(mr), k -> new ArrayList<>()).add(new IOEntry(pending, mr));
        }
    }

    void scheduleMicrotask(Callable fn) { microtaskQueue.add(fn); }

    int scheduleImmediate(Callable fn) {
        int id = nextCheckId++;
        checkMap.put(id, fn);
        return id;
    }

    void cancelImmediate(int id) { checkMap.remove(id); }

    // ------------------------------------------------------------------ phase execution

    /**
     * Phase 1: resume the {@code os.sleep()} continuation waiting for {@code timerId}, if any.
     * Automatically drains microtasks afterward (Phase 3).
     */
    MachineResult drainTimers(Context cx, Scriptable scope, int timerId) {
        var pending = timerMap.remove(timerId);
        if (pending == null) return MachineResult.OK;
        var result = resumeContinuation(cx, scope, pending, Undefined.instance);
        if (result.isError()) return result;
        return drainMicrotasks(cx, scope);
    }

    /**
     * Phase 2: resume all I/O continuations whose event-filter matches {@code eventName}.
     * {@code fullArgs} must be {@code [eventName, ...originalArgs]}.
     * Automatically drains microtasks afterward (Phase 3).
     */
    MachineResult drainIO(Context cx, Scriptable scope, String eventName, Object[] fullArgs) {
        // Wildcard continuations (null filter) first — they accept any event.
        var r = drainIOBucket(cx, scope, null, fullArgs);
        if (r.isError()) return r;
        // Then event-specific continuations.
        r = drainIOBucket(cx, scope, eventName, fullArgs);
        if (r.isError()) return r;
        return drainMicrotasks(cx, scope);
    }

    private MachineResult drainIOBucket(
        Context cx, Scriptable scope, @Nullable String key, Object[] fullArgs
    ) {
        var bucket = ioMap.remove(key);
        if (bucket == null || bucket.isEmpty()) return MachineResult.OK;
        for (var entry : bucket) {
            var callback = entry.mr().getCallback();
            if (callback == null) continue;
            MethodResult newMr;
            try {
                newMr = callback.resume(fullArgs);
            } catch (ScriptException e) {
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            }
            if (newMr.getCallback() == null) {
                // Callback chain complete — resume the stored Rhino continuation.
                var jsResult = JSValues.toJsResult(cx, scope, newMr.getResult());
                var r = resumeContinuation(cx, scope, entry.pending(), jsResult);
                if (r.isError()) return r;
            } else {
                // Chain still waiting — re-bucket with updated MethodResult.
                entry.pending().setApplicationState(newMr);
                ioMap.computeIfAbsent(filterOf(newMr), k -> new ArrayList<>())
                     .add(new IOEntry(entry.pending(), newMr));
            }
        }
        return MachineResult.OK;
    }

    /**
     * Phase 3: drain all queued JS microtask callbacks ({@code queueMicrotask}).
     * New microtasks enqueued during draining are also processed before returning (standard
     * browser/Node.js behaviour). Called automatically after Phase 1, Phase 2, and Phase 4.
     * {@code os.yield()} continuations are <em>not</em> drained here — they run in Phase 4.
     */
    MachineResult drainMicrotasks(Context cx, Scriptable scope) {
        // JS microtask callbacks — drained recursively (new microtasks run this cycle).
        while (!microtaskQueue.isEmpty()) {
            var fn = microtaskQueue.poll();
            try {
                cx.callFunctionWithContinuations(fn, scope, new Object[0]);
            } catch (ContinuationPending p) {
                schedule(p);
            } catch (RhinoException e) {
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            } catch (Exception e) {
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
        return MachineResult.OK;
    }

    /**
     * Phase 4: resume all {@code os.yield()} continuations captured this cycle.
     * Uses a snapshot-clear so re-yields from resumed code land in {@code pendingYields} after the
     * snapshot and are deferred to the next {@code handleEvent} call — exactly one yield-loop
     * iteration per game tick. Drains microtasks after resuming.
     */
    MachineResult drainYields(Context cx, Scriptable scope) {
        if (pendingYields.isEmpty()) return MachineResult.OK;
        var snapshot = new ArrayList<>(pendingYields);
        pendingYields.clear();
        for (var pending : snapshot) {
            var r = resumeContinuation(cx, scope, pending, Undefined.instance);
            if (r.isError()) return r;
        }
        return drainMicrotasks(cx, scope);
    }

    /**
     * Phase 5: run all {@code setImmediate} callbacks registered before this cycle started.
     * Callbacks added during this phase run in the <em>next</em> cycle.
     * Drains microtasks after all callbacks complete.
     */
    MachineResult drainCheck(Context cx, Scriptable scope) {
        if (checkMap.isEmpty()) return MachineResult.OK;
        var snapshot = new ArrayList<>(checkMap.values());
        checkMap.clear();
        for (var fn : snapshot) {
            try {
                cx.callFunctionWithContinuations(fn, scope, new Object[0]);
            } catch (ContinuationPending p) {
                schedule(p);
            } catch (RhinoException e) {
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            } catch (Exception e) {
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
        return drainMicrotasks(cx, scope);
    }

    // ------------------------------------------------------------------ internal

    /**
     * Resume {@code pending} with {@code jsResult}. If the resumed code yields again the new
     * continuation is routed back through {@link #schedule(ContinuationPending)}.
     */
    MachineResult resumeContinuation(Context cx, Scriptable scope, ContinuationPending pending, Object jsResult) {
        try {
            cx.resumeContinuation(pending.getContinuation(), scope, jsResult);
        } catch (ContinuationPending newPending) {
            schedule(newPending);
        } catch (EvaluatorException e) {
            return mapEvaluator(e);
        } catch (RhinoException e) {
            return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
        } catch (Exception e) {
            return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
        }
        return MachineResult.OK;
    }

    private static MachineResult mapEvaluator(EvaluatorException e) {
        var msg = e.getMessage();
        if (JSMachine.HARD_ABORT_MESSAGE.equals(msg)) return MachineResult.TIMEOUT;
        if (TimeoutState.ABORT_MESSAGE.equals(msg)) return MachineResult.error(TimeoutState.ABORT_MESSAGE);
        return MachineResult.error(msg != null ? msg : e.toString());
    }

    @Nullable
    private static String filterOf(MethodResult mr) {
        var r = mr.getResult();
        return (r != null && r.length > 0 && r[0] instanceof String s) ? s : null;
    }

    boolean hasPending() {
        return !timerMap.isEmpty() || !ioMap.isEmpty() || !pendingYields.isEmpty() || !checkMap.isEmpty();
    }

    void clear() {
        timerMap.clear();
        ioMap.clear();
        pendingYields.clear();
        microtaskQueue.clear();
        checkMap.clear();
    }
}
