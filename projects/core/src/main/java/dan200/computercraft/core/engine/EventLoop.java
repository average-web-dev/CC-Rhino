// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptException;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * Node.js-inspired event loop for the JS runtime, with green threads.
 *
 * <ul>
 *   <li>Phase 1 — Timers: resumes {@code os.sleep()} continuations whose CC timer fires.</li>
 *   <li>Phase 2 — I/O: resumes continuations waiting for a specific CC event (turtle ops, modem, etc.).</li>
 *   <li>Phase 3 — Run queue + microtasks: starts green threads, resumes {@code parallel.waitFor*} callers and drains
 *   {@code queueMicrotask()} callbacks. Runs after each other phase.</li>
 *   <li>Phase 4 — Yields: resumes {@code os.yield()} continuations (snapshot-clear, one pass per tick).</li>
 *   <li>Phase 5 — Check: runs {@code setImmediate()} callbacks.</li>
 * </ul>
 *
 * <p>Each continuation is stored in the bucket matching its phase rather than a flat list.
 * This lets Phase 1 find expired timers in O(1) and Phase 2 find event-matched continuations in O(1)
 * instead of scanning the whole list on every event.
 *
 * <h2>Threads</h2>
 * All JS runs as a {@link Strand} of some {@link JSThread}, and everything parked or queued here remembers its strand
 * (or owning thread). JS is only ever entered from this class (via {@link #run}), never from inside another JS call:
 * work created while JS runs — starting a thread, resuming a {@code waitFor*} caller — goes through the run queue.
 * See {@link JSThread} for how stopping a thread discards its work and {@link #terminate} for {@code Ctrl+T}.
 *
 * @see JSMachine
 */
public final class EventLoop {
    private static final Logger LOG = LoggerFactory.getLogger(EventLoop.class);
    private static final Object[] NO_ARGS = new Object[0];
    static final String TERMINATED = "Terminated";

    private record Parked(Strand strand, ContinuationPending pending) {}

    private record IOEntry(Strand strand, ContinuationPending pending, MethodResult mr) {}

    private record Task(JSThread owner, Callable fn) {}

    /** An item of the run queue. */
    private sealed interface Ready permits Start, Resume {}

    /** Run {@code fn} as the main strand of {@code thread}. */
    private record Start(JSThread thread, Callable fn) implements Ready {}

    /** Resume a parked continuation with {@code value}, or make its call site throw {@code value} if {@code fail}. */
    private record Resume(Strand strand, ContinuationPending pending, Object value, boolean fail) implements Ready {}

    @FunctionalInterface
    private interface Body {
        void run();
    }

    private final JSCallShim shim;
    private final JSEventEmitter emitter;
    private final JSThread root = new JSThread(0, null, null, 0);
    private int nextThreadId = 1;
    private @Nullable Strand current;

    // Phase 1 — timer ID → sleep continuation
    private final Map<Integer, Parked> timerMap = new HashMap<>();

    // Phase 2 — event filter → pending I/O continuations (null key = wildcard, accepts any event)
    private final Map<@Nullable String, List<IOEntry>> ioMap = new HashMap<>();

    // Phase 3 — threads to start and continuations to resume, in order
    private final ArrayDeque<Ready> ready = new ArrayDeque<>();

    // Phase 3 — JS microtask callbacks (queueMicrotask)
    private final ArrayDeque<Task> microtaskQueue = new ArrayDeque<>();

    // Phase 4 — yield continuations (os.yield); snapshot-clear per pass
    private final ArrayDeque<Parked> pendingYields = new ArrayDeque<>();

    // Phase 5 — setImmediate callbacks (LinkedHashMap keeps insertion order so clearImmediate by ID works)
    private final LinkedHashMap<Integer, Task> checkMap = new LinkedHashMap<>();
    private int nextCheckId = 0;

    EventLoop(JSCallShim shim) {
        this.shim = shim;
        emitter = new JSEventEmitter(this);
    }

    JSEventEmitter emitter() {
        return emitter;
    }

    // ------------------------------------------------------------------ threads

    /** The thread the currently running JS belongs to (the root thread when no JS is running). */
    JSThread currentThread() {
        var strand = current;
        return strand == null ? root : strand.thread().effective();
    }

    /** Start {@code fn} as a background thread owned by the current thread. It starts once the current strand yields. */
    JSThread spawn(Callable fn) {
        var parent = currentThread();
        var thread = new JSThread(nextThreadId++, parent, null, 0);
        if (parent.isDead()) {
            thread.markKilled();
        } else {
            ready.add(new Start(thread, fn));
        }
        return thread;
    }

    /** Stop a thread: it and its descendants are killed and all their pending work is discarded. */
    void stop(JSThread thread) {
        if (thread.state == JSThread.State.RUNNING && !thread.isRoot()) kill(thread);
    }

    /**
     * Deliver {@code terminate} (Ctrl+T): every foreground thread (see {@link JSThread#isForeground()}) blocked in a
     * sleep, I/O wait or yield is resumed so that the blocking call throws {@code Error("Terminated")}. A thread that
     * does not catch it fails, which fails its {@code waitFor*} group in turn, and so on up to the caller — usually the
     * shell. Threads blocked in a {@code waitFor*} are reached through their children; spawned (background) threads and
     * the root thread are left alone.
     */
    void terminate(Context cx, Scriptable scope) {
        var targets = new ArrayList<Parked>();
        timerMap.values().removeIf(p -> takeTerminable(p.strand(), p.pending(), targets));
        for (var it = ioMap.values().iterator(); it.hasNext(); ) {
            var list = it.next();
            list.removeIf(e -> takeTerminable(e.strand(), e.pending(), targets));
            if (list.isEmpty()) it.remove();
        }
        pendingYields.removeIf(p -> takeTerminable(p.strand(), p.pending(), targets));

        for (var target : targets) {
            ready.add(new Resume(target.strand(), target.pending(), newError(cx, scope, "Error", TERMINATED), true));
        }
    }

    private static boolean takeTerminable(Strand strand, ContinuationPending pending, List<Parked> targets) {
        var thread = strand.thread();
        if (!strand.main() || thread.state != JSThread.State.RUNNING || thread.isRoot() || !thread.isForeground()) {
            return false;
        }
        targets.add(new Parked(strand, pending));
        return true;
    }

    private void kill(JSThread thread) {
        thread.markKilled();
        purge();
    }

    /** The main strand of {@code thread} returned: the thread is done, and its group may now be complete. */
    private void threadReturned(JSThread thread) {
        if (thread.isRoot() || thread.state != JSThread.State.RUNNING) return;
        thread.markReturned();
        var group = thread.group;
        if (group != null && !group.settled && group.onReturned(thread)) settle(group, group.result(), false);
    }

    /** {@code thread} threw {@code error}: kill it, and fail its group so the error reaches the waiting caller. */
    private void threadFailed(JSThread thread, Object error) {
        if (thread.state != JSThread.State.RUNNING) return;
        thread.error = error;
        kill(thread);
        var group = thread.group;
        if (group != null && !group.settled) settle(group, error, true);
    }

    /** Finish a group: kill its remaining threads and queue the waiting caller's resumption. */
    private void settle(JSTaskGroup group, Object value, boolean fail) {
        group.settled = true;
        for (var thread : group.threads) {
            if (thread.state == JSThread.State.RUNNING) thread.markKilled();
        }
        purge();
        ready.add(new Resume(group.waiter, group.pending, value, fail));
    }

    /** Create the threads of a {@code waitFor*} call whose caller has just been parked. */
    private void startGroup(Strand waiter, ContinuationPending pending, JSTaskGroup.Request request) {
        var group = new JSTaskGroup(request.mode(), request.needed(), waiter, pending);
        var parent = waiter.thread().effective();
        var tasks = request.tasks();
        for (var i = 0; i < tasks.size(); i++) {
            var thread = new JSThread(nextThreadId++, parent, group, i);
            group.threads.add(thread);
            ready.add(new Start(thread, tasks.get(i)));
        }
    }

    /** Discard everything owned by killed threads. */
    private void purge() {
        timerMap.values().removeIf(p -> p.strand().thread().isDead());
        for (var it = ioMap.values().iterator(); it.hasNext(); ) {
            var list = it.next();
            list.removeIf(e -> e.strand().thread().isDead());
            if (list.isEmpty()) it.remove();
        }
        pendingYields.removeIf(p -> p.strand().thread().isDead());
        microtaskQueue.removeIf(t -> t.owner().isDead());
        checkMap.values().removeIf(t -> t.owner().isDead());
        ready.removeIf(EventLoop::isDead);
        emitter.removeDead();
    }

    private static boolean isDead(Ready item) {
        if (item instanceof Start start) return start.thread().state != JSThread.State.RUNNING;
        return ((Resume) item).strand().thread().isDead();
    }

    // ------------------------------------------------------------------ scheduling

    /**
     * Route a freshly-caught {@link ContinuationPending} into the correct place. A {@code waitFor*} call starts its
     * group; otherwise {@link MethodResult#getDestination()} picks the bucket: TIMER → Phase 1; YIELD → Phase 4;
     * IO → Phase 2.
     */
    private void park(Strand strand, ContinuationPending pending) {
        if (strand.thread().isDead()) return;
        var state = pending.getApplicationState();
        if (state instanceof JSTaskGroup.Request request) {
            startGroup(strand, pending, request);
            return;
        }
        if (!(state instanceof MethodResult mr)) return;
        var dest = mr.getDestination();
        if (dest == null) return;
        switch (dest) {
            case TIMER -> {
                var r = mr.getResult();
                if (r != null && r.length > 0 && r[0] instanceof Number n) timerMap.put(n.intValue(), new Parked(strand, pending));
            }
            case YIELD -> pendingYields.add(new Parked(strand, pending));
            case IO -> ioMap.computeIfAbsent(filterOf(mr), k -> new ArrayList<>()).add(new IOEntry(strand, pending, mr));
        }
    }

    public void scheduleMicrotask(Callable fn) {
        var owner = currentThread();
        if (!owner.isDead()) microtaskQueue.add(new Task(owner, fn));
    }

    public int scheduleImmediate(Callable fn) {
        int id = nextCheckId++;
        var owner = currentThread();
        if (!owner.isDead()) checkMap.put(id, new Task(owner, fn));
        return id;
    }

    public void cancelImmediate(int id) { checkMap.remove(id); }

    // ------------------------------------------------------------------ phase execution

    /** Run the bios script as the root thread. */
    MachineResult runBios(Context cx, Scriptable scope, Script bios) {
        return run(cx, scope, new Strand(root, true), () -> cx.executeScriptWithContinuations(bios, scope));
    }

    /** Invoke the {@code events.on} listeners for {@code event}, each as a strand of the thread that registered it. */
    MachineResult emit(Context cx, Scriptable scope, String event, Object[] jsArgs) {
        for (var entry : emitter.take(event)) {
            if (entry.owner().isDead()) continue;
            var r = run(cx, scope, new Strand(entry.owner(), false),
                () -> cx.callFunctionWithContinuations(entry.fn(), scope, jsArgs));
            if (r.isError()) return r;
        }
        return MachineResult.OK;
    }

    /**
     * Phase 1: resume the {@code os.sleep()} continuation waiting for {@code timerId}, if any.
     * Automatically drains the run queue and microtasks afterward (Phase 3).
     */
    MachineResult drainTimers(Context cx, Scriptable scope, int timerId) {
        var parked = timerMap.remove(timerId);
        if (parked == null) return MachineResult.OK;
        var result = resume(cx, scope, parked.strand(), parked.pending(), Undefined.instance);
        if (result.isError()) return result;
        return drainMicrotasks(cx, scope);
    }

    /**
     * Phase 2: resume all I/O continuations whose event-filter matches {@code eventName}.
     * {@code fullArgs} must be {@code [eventName, ...originalArgs]}.
     * Automatically drains the run queue and microtasks afterward (Phase 3).
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
        for (int i = 0; i < bucket.size(); i++) {
            var entry = bucket.get(i);
            // A thread killed by an earlier entry of this pass.
            if (entry.strand().thread().isDead()) continue;
            var callback = entry.mr().getCallback();
            if (callback == null) continue;
            Object jsResult;
            try {
                var newMr = callback.resume(fullArgs);
                if (newMr.getCallback() != null) {
                    // Chain still waiting — re-bucket with updated MethodResult.
                    entry.pending().setApplicationState(newMr);
                    ioMap.computeIfAbsent(filterOf(newMr), k -> new ArrayList<>())
                         .add(new IOEntry(entry.strand(), entry.pending(), newMr));
                    continue;
                }
                // Callback chain complete — resume the stored Rhino continuation with its result.
                jsResult = JSValues.toJsResult(cx, scope, newMr.getResult());
            } catch (ScriptException e) {
                // The call failed — resume so that it throws at its JS call site (see JSCallShim).
                jsResult = shim.failure(cx, scope, e.getMessage() != null ? e.getMessage() : e.toString());
            } catch (RuntimeException e) {
                // A bug in the native callback: as in JSMethodBridge, log it but don't leak Java details to scripts.
                LOG.error("Unexpected exception in native callback", e);
                jsResult = shim.failure(cx, scope, JSMethodBridge.INTERNAL_ERROR_MESSAGE);
            }
            var r = resume(cx, scope, entry.strand(), entry.pending(), jsResult);
            if (r.isError()) {
                // Keep the entries we haven't visited yet parked, ahead of any re-bucketed during this pass.
                var rest = bucket.subList(i + 1, bucket.size());
                if (!rest.isEmpty()) ioMap.computeIfAbsent(key, k -> new ArrayList<>()).addAll(0, rest);
                return r;
            }
        }
        return MachineResult.OK;
    }

    /**
     * Phase 3: work through the run queue (starting threads, resuming {@code waitFor*} callers) and drain all queued
     * JS microtask callbacks ({@code queueMicrotask}). Work queued while draining is also processed before returning
     * (standard browser/Node.js behaviour for microtasks). Called automatically after every other phase.
     * {@code os.yield()} continuations are <em>not</em> drained here — they run in Phase 4.
     */
    MachineResult drainMicrotasks(Context cx, Scriptable scope) {
        while (true) {
            var item = ready.poll();
            if (item != null) {
                var r = runReady(cx, scope, item);
                if (r.isError()) return r;
                continue;
            }

            var task = microtaskQueue.poll();
            if (task == null) return MachineResult.OK;
            if (task.owner().isDead()) continue;
            var r = run(cx, scope, new Strand(task.owner(), false),
                () -> cx.callFunctionWithContinuations(task.fn(), scope, NO_ARGS));
            if (r.isError()) return r;
        }
    }

    private MachineResult runReady(Context cx, Scriptable scope, Ready item) {
        if (isDead(item)) return MachineResult.OK;
        if (item instanceof Start start) {
            return run(cx, scope, new Strand(start.thread(), true),
                () -> cx.callFunctionWithContinuations(start.fn(), scope, NO_ARGS));
        }
        var resume = (Resume) item;
        var value = resume.fail() ? shim.failureWith(cx, scope, resume.value()) : resume.value();
        return resume(cx, scope, resume.strand(), resume.pending(), value);
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
        for (var parked : snapshot) {
            if (parked.strand().thread().isDead()) continue;
            var r = resume(cx, scope, parked.strand(), parked.pending(), Undefined.instance);
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
        // Snapshot the IDs, not the callbacks: an earlier callback may still clearImmediate() a later one.
        var snapshot = new ArrayList<>(checkMap.keySet());
        for (var id : snapshot) {
            var task = checkMap.remove(id);
            if (task == null || task.owner().isDead()) continue;
            var r = run(cx, scope, new Strand(task.owner(), false),
                () -> cx.callFunctionWithContinuations(task.fn(), scope, NO_ARGS));
            if (r.isError()) return r;
        }
        return drainMicrotasks(cx, scope);
    }

    // ------------------------------------------------------------------ internal

    /**
     * Resume {@code pending} with {@code jsResult}. If the resumed code yields again the new
     * continuation is parked again through {@link #park}.
     */
    private MachineResult resume(Context cx, Scriptable scope, Strand strand, ContinuationPending pending, Object jsResult) {
        return run(cx, scope, strand, () -> cx.resumeContinuation(pending.getContinuation(), scope, jsResult));
    }

    /**
     * Run one piece of JS as {@code strand}: park the continuation if it blocks, finish the thread if its main strand
     * completes, and turn an uncaught error into a thread failure.
     *
     * <p>An uncaught error in work owned by the root thread (the bios, a shell listener, …) still stops the machine, as
     * there is nobody to report it to. Timeouts and hard aborts always stop the machine.
     */
    private MachineResult run(Context cx, Scriptable scope, Strand strand, Body body) {
        var previous = current;
        current = strand;
        try {
            body.run();
            if (strand.main()) threadReturned(strand.thread());
            return MachineResult.OK;
        } catch (ContinuationPending pending) {
            park(strand, pending);
            return MachineResult.OK;
        } catch (RuntimeException e) {
            return uncaught(cx, scope, strand, e);
        } finally {
            current = previous;
        }
    }

    /**
     * The single mapping for an exception escaping a piece of JS, whichever phase ran it. An abort ({@link JSAbort})
     * always stops the machine, a hard abort as {@link MachineResult#TIMEOUT}. Any other error fails the strand's
     * thread; an error in work owned by the root thread stops the machine.
     */
    private MachineResult uncaught(Context cx, Scriptable scope, Strand strand, RuntimeException e) {
        if (e instanceof JSAbort abort) return abort.result();
        var owner = strand.thread().effective();
        if (owner.isRoot()) return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
        threadFailed(owner, errorValue(cx, scope, e));
        return MachineResult.OK;
    }

    /** The JS value an uncaught exception carries, so a {@code waitFor*} caller can rethrow it unchanged. */
    private static Object errorValue(Context cx, Scriptable scope, RuntimeException e) {
        if (e instanceof JavaScriptException js) return js.getValue();
        if (e instanceof EcmaError ecma) return newError(cx, scope, ecma.getName(), ecma.getErrorMessage());
        if (e instanceof WrappedException wrapped) {
            var inner = wrapped.getWrappedException();
            return newError(cx, scope, "Error", inner.getMessage() != null ? inner.getMessage() : inner.toString());
        }
        if (e instanceof RhinoException rhino) return newError(cx, scope, "Error", rhino.details());
        return newError(cx, scope, "Error", e.getMessage() != null ? e.getMessage() : e.toString());
    }

    private static Scriptable newError(Context cx, Scriptable scope, String constructor, String message) {
        try {
            return cx.newObject(scope, constructor, new Object[]{ message });
        } catch (RuntimeException e) {
            return cx.newObject(scope, "Error", new Object[]{ message });
        }
    }

    @Nullable
    private static String filterOf(MethodResult mr) {
        var r = mr.getResult();
        return (r != null && r.length > 0 && r[0] instanceof String s) ? s : null;
    }

    /**
     * Returns {@code true} if there is internal work that cannot self-schedule via a real CC event and therefore
     * requires a synthetic {@code cc:js-tick} to keep the loop running.
     * Timers, I/O continuations and parked {@code waitFor*} callers are excluded — they are woken by real CC events
     * ({@code timer}, etc.) or by the threads they wait for.
     */
    boolean needsSelfTick() {
        return !ready.isEmpty() || !microtaskQueue.isEmpty() || !checkMap.isEmpty() || !pendingYields.isEmpty();
    }

    void clear() {
        timerMap.clear();
        ioMap.clear();
        ready.clear();
        pendingYields.clear();
        microtaskQueue.clear();
        checkMap.clear();
    }
}
