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
 *   <li>Phase 3 — Run queue + microtasks: starts green threads, resumes {@code parallel.waitFor*} and
 *   {@code async.unwrap} callers and drains {@code queueMicrotask()} callbacks and Rhino {@code Promise} jobs (one
 *   shared FIFO queue, as in Node). Runs after each other phase.</li>
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
 * <h2>Promises</h2>
 * A parked operation is woken through its {@link Waiter}: a blocking call's continuation is resumed, while an operation
 * started through a {@code <module>/promises} module settles its promise instead (see {@link JSPromises}). Promise
 * jobs run from the microtask queue; they are plain Java calls into JS, so code running in them is "async code" and
 * cannot block (see {@link #inAsyncCode()}). Promise reactions belong to the thread that registered them (see
 * {@link JSPromises}): a reaction of a stopped thread never runs. A pending native operation of a stopped thread is
 * discarded and its promise rejected with {@code Error("Terminated")}, so other threads awaiting it are not left
 * hanging.
 *
 * @see JSMachine
 */
public final class EventLoop {
    private static final Logger LOG = LoggerFactory.getLogger(EventLoop.class);
    private static final Object[] NO_ARGS = new Object[0];
    static final String TERMINATED = "Terminated";
    /** The event an unhandled rejection is reported with when no running thread owns it (see {@link #checkRejections}). */
    static final String UNHANDLED_REJECTION_EVENT = "unhandled_rejection";

    private record Parked(Strand strand, Waiter waiter) {}

    private record IOEntry(Strand strand, Waiter waiter, MethodResult mr) {}

    /** An item of the microtask queue. */
    private sealed interface Micro permits Task, Job {}

    /** A JS callback ({@code queueMicrotask}, {@code setImmediate}) run on behalf of {@code owner}. */
    private record Task(JSThread owner, Callable fn) implements Micro {}

    /** A Rhino promise job, queued while {@code owner} was running. */
    private record Job(JSThread owner, Runnable job) implements Micro {}

    /** An item of the run queue. */
    private sealed interface Ready permits Start, Resume, Cancel {}

    /** Run {@code fn} as the main strand of {@code thread}. */
    private record Start(JSThread thread, Callable fn) implements Ready {}

    /** Wake a parked waiter with {@code value}, or with the failure {@code value} if {@code fail}. */
    private record Resume(Strand strand, Waiter waiter, Object value, boolean fail) implements Ready {}

    /** Reject the promise of an operation that was discarded because the thread that started it was stopped. */
    private record Cancel(Waiter.Promised waiter) implements Ready {}

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

    // Phase 3 — JS microtask callbacks (queueMicrotask) and Rhino promise jobs
    private final ArrayDeque<Micro> microtaskQueue = new ArrayDeque<>();

    // Phase 4 — yield continuations (os.yield); snapshot-clear per pass
    private final ArrayDeque<Parked> pendingYields = new ArrayDeque<>();

    // Phase 5 — setImmediate callbacks (LinkedHashMap keeps insertion order so clearImmediate by ID works)
    private final LinkedHashMap<Integer, Task> checkMap = new LinkedHashMap<>();
    private int nextCheckId = 0;

    // async.unwrap callers waiting for a promise to settle
    private final List<Parked> awaiting = new ArrayList<>();

    // parallel/promises groups, so their promise can be rejected if the calling thread is stopped
    private final List<JSTaskGroup> promiseGroups = new ArrayList<>();

    // Nesting depth of generator resumptions and promise jobs: JS running there is entered from Java and cannot block.
    private int generatorDepth = 0;
    private int promiseJobDepth = 0;

    // Unhandled-rejection tracking (see checkRejections): promises created since the last check, rejections not yet
    // reported, and every promise a handler was attached to.
    private record Candidate(Scriptable promise, JSThread owner) {}

    private record Rejection(Scriptable promise, JSThread owner, @Nullable Object reason) {}

    private final List<Candidate> freshPromises = new ArrayList<>();
    private final List<Rejection> rejections = new ArrayList<>();
    private final Set<Scriptable> handledPromises = Collections.newSetFromMap(new WeakHashMap<>());
    private @Nullable Callable promiseThen;
    private boolean trackingSuppressed = false;

    // Set when the safepoint aborts the machine. Rhino's promise machinery catches the abort like any other error, so
    // it may never propagate to us; every piece of JS checks this afterwards instead.
    private @Nullable JSAbort abort;

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
     * sleep, I/O wait, yield or {@code async.unwrap} is resumed so that the blocking call throws
     * {@code Error("Terminated")}. A thread that does not catch it fails, which fails its {@code waitFor*} group in
     * turn, and so on up to the caller — usually the shell. Threads blocked in a {@code waitFor*} are reached through
     * their children; spawned (background) threads and the root thread are left alone.
     */
    void terminate(Context cx, Scriptable scope) {
        var targets = new ArrayList<Parked>();
        timerMap.values().removeIf(p -> takeTerminable(p.strand(), p.waiter(), targets));
        for (var it = ioMap.values().iterator(); it.hasNext(); ) {
            var list = it.next();
            list.removeIf(e -> takeTerminable(e.strand(), e.waiter(), targets));
            if (list.isEmpty()) it.remove();
        }
        pendingYields.removeIf(p -> takeTerminable(p.strand(), p.waiter(), targets));
        awaiting.removeIf(p -> takeTerminable(p.strand(), p.waiter(), targets));

        for (var target : targets) {
            ready.add(new Resume(target.strand(), target.waiter(), newError(cx, scope, "Error", TERMINATED), true));
        }
    }

    /**
     * Whether a parked waiter receives {@code terminate}. Only the blocked main strand of a foreground thread does, so
     * operations started through a {@code /promises} module (parked on a non-main strand) are left alone: they end
     * when the thread that started them fails.
     */
    private static boolean takeTerminable(Strand strand, Waiter waiter, List<Parked> targets) {
        var thread = strand.thread();
        if (!strand.main() || thread.state != JSThread.State.RUNNING || thread.isRoot() || !thread.isForeground()) {
            return false;
        }
        targets.add(new Parked(strand, waiter));
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
        ready.add(new Resume(group.waiter, group.wake, value, fail));
    }

    /** Create the threads of a {@code waitFor*} call whose caller has just been parked (or was handed a promise). */
    private void startGroup(Strand waiter, Waiter wake, JSTaskGroup.Request request) {
        var group = new JSTaskGroup(request.mode(), request.needed(), waiter, wake);
        if (wake instanceof Waiter.Promised) promiseGroups.add(group);
        var parent = waiter.thread().effective();
        var tasks = request.tasks();
        for (var i = 0; i < tasks.size(); i++) {
            var thread = new JSThread(nextThreadId++, parent, group, i);
            group.threads.add(thread);
            ready.add(new Start(thread, tasks.get(i)));
        }
    }

    /**
     * Discard everything owned by killed threads. The promise of a discarded {@code /promises} operation is rejected
     * with {@code Error("Terminated")} (see {@link Cancel}). Promise jobs are never discarded here, as each reaction
     * checks its own owner (see {@link JSPromises}).
     */
    private void purge() {
        var cancelled = new ArrayList<Cancel>();
        timerMap.values().removeIf(p -> discard(p.strand(), p.waiter(), cancelled));
        for (var it = ioMap.values().iterator(); it.hasNext(); ) {
            var list = it.next();
            list.removeIf(e -> discard(e.strand(), e.waiter(), cancelled));
            if (list.isEmpty()) it.remove();
        }
        pendingYields.removeIf(p -> discard(p.strand(), p.waiter(), cancelled));
        awaiting.removeIf(p -> p.strand().thread().isDead());
        promiseGroups.removeIf(g -> g.settled || discard(g.waiter, g.wake, cancelled));
        microtaskQueue.removeIf(m -> m instanceof Task t && t.owner().isDead());
        checkMap.values().removeIf(t -> t.owner().isDead());
        ready.removeIf(item -> item instanceof Resume r ? discard(r.strand(), r.waiter(), cancelled) : isDead(item));
        ready.addAll(cancelled);
        emitter.removeDead();
    }

    /** Whether a waiter belongs to a killed thread. If so, and it is a promise, its rejection is added to {@code cancelled}. */
    private static boolean discard(Strand strand, Waiter waiter, List<Cancel> cancelled) {
        if (!strand.thread().isDead()) return false;
        if (waiter instanceof Waiter.Promised promised) cancelled.add(new Cancel(promised));
        return true;
    }

    private static boolean isDead(Ready item) {
        return switch (item) {
            case Start start -> start.thread().state != JSThread.State.RUNNING;
            case Resume resume -> resume.strand().thread().isDead();
            case Cancel ignored -> false;
        };
    }

    // ------------------------------------------------------------------ scheduling

    /**
     * Route a freshly-caught {@link ContinuationPending} into the correct place. A {@code waitFor*} call starts its
     * group and an {@code async.unwrap} call waits for its promise; otherwise it is a native operation, parked by
     * {@link #parkOperation}.
     */
    private void park(Context cx, Scriptable scope, Strand strand, ContinuationPending pending) {
        if (strand.thread().isDead()) return;
        var state = pending.getApplicationState();
        var waiter = new Waiter.Blocked(pending);
        if (state instanceof JSTaskGroup.Request request) {
            startGroup(strand, waiter, request);
        } else if (state instanceof JSPromises.Await await) {
            awaitPromise(cx, scope, new Parked(strand, waiter), await.thenable());
        } else if (state instanceof MethodResult mr) {
            parkOperation(strand, waiter, mr);
        }
    }

    /**
     * Park a pending native operation in the bucket {@link MethodResult#getDestination()} picks: TIMER → Phase 1;
     * YIELD → Phase 4; IO → Phase 2.
     */
    private void parkOperation(Strand strand, Waiter waiter, MethodResult mr) {
        var dest = mr.getDestination();
        if (dest == null) return;
        switch (dest) {
            case TIMER -> {
                var r = mr.getResult();
                if (r != null && r.length > 0 && r[0] instanceof Number n) timerMap.put(n.intValue(), new Parked(strand, waiter));
            }
            case YIELD -> pendingYields.add(new Parked(strand, waiter));
            case IO -> ioMap.computeIfAbsent(filterOf(mr), k -> new ArrayList<>()).add(new IOEntry(strand, waiter, mr));
        }
    }

    /**
     * Park a native operation started through a {@code /promises} module. It belongs to the current thread, but is
     * parked on a non-main strand, so {@code terminate} does not reach it.
     */
    void parkPromise(MethodResult mr, Waiter.Promised waiter) {
        var owner = currentThread();
        if (owner.isDead()) return;
        parkOperation(new Strand(owner, false), waiter, mr);
    }

    /** Start the threads of a {@code parallel/promises} {@code waitFor*} call, whose promise settles with the group. */
    void startPromiseGroup(JSTaskGroup.Request request, Waiter.Promised waiter) {
        var owner = currentThread();
        if (owner.isDead()) return;
        startGroup(new Strand(owner, false), waiter, request);
    }

    /**
     * Wait for {@code thenable} on behalf of an {@code async.unwrap} caller: once it settles, the caller is resumed (or
     * fails) through the run queue. A thenable whose {@code then} throws fails the caller straight away.
     */
    private void awaitPromise(Context cx, Scriptable scope, Parked parked, Scriptable thenable) {
        awaiting.add(parked);
        var onFulfilled = new AwaitReaction(parked, false);
        var onRejected = new AwaitReaction(parked, true);
        ScriptRuntime.setFunctionProtoAndParent(onFulfilled, cx, scope);
        ScriptRuntime.setFunctionProtoAndParent(onRejected, cx, scope);
        try {
            ScriptableObject.callMethod(cx, thenable, "then", new Object[]{ onFulfilled, onRejected });
        } catch (JSAbort e) {
            throw e;
        } catch (RhinoException e) {
            if (awaiting.remove(parked)) ready.add(new Resume(parked.strand(), parked.waiter(), errorValue(cx, scope, e), true));
        }
    }

    /** A reaction registered by {@link #awaitPromise}: queues the waiting caller's resumption. */
    @SuppressWarnings("serial") // never serialized
    private final class AwaitReaction extends BaseFunction {
        private static final long serialVersionUID = 1L;

        private final Parked parked;
        private final boolean fail;

        AwaitReaction(Parked parked, boolean fail) {
            this.parked = parked;
            this.fail = fail;
        }

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            // Only if it is still parked, i.e. it was neither terminated nor discarded with its thread.
            if (awaiting.remove(parked)) {
                ready.add(new Resume(parked.strand(), parked.waiter(), args.length > 0 ? args[0] : Undefined.instance, fail));
            }
            return Undefined.instance;
        }
    }

    public void scheduleMicrotask(Callable fn) {
        var owner = currentThread();
        if (!owner.isDead()) microtaskQueue.add(new Task(owner, fn));
    }

    /**
     * Queue a Rhino promise job ({@code JSMachine}'s context routes {@link Context#enqueueMicrotask} here). Jobs share
     * the microtask queue with {@code queueMicrotask} callbacks, so both run in FIFO order.
     */
    void schedulePromiseJob(Runnable job) {
        microtaskQueue.add(new Job(currentThread(), job));
    }

    public int scheduleImmediate(Callable fn) {
        int id = nextCheckId++;
        var owner = currentThread();
        if (!owner.isDead()) checkMap.put(id, new Task(owner, fn));
        return id;
    }

    public void cancelImmediate(int id) { checkMap.remove(id); }

    // ------------------------------------------------------------------ async code

    /**
     * Whether the running JS was entered from Java — a generator resumed by {@code next}/{@code throw}/{@code return},
     * or a promise job — rather than by the event loop. A continuation cannot be captured there, so blocking calls
     * fail with a clear error instead (see {@link JSPromises#blockingError}).
     */
    boolean inAsyncCode() {
        return generatorDepth > 0 || promiseJobDepth > 0;
    }

    void enterGenerator() {
        generatorDepth++;
    }

    void exitGenerator() {
        generatorDepth--;
    }

    /**
     * Call {@code fn} as a strand of {@code owner}, so that work it starts (threads, listeners, native operations, …)
     * belongs to that thread. Used for promise reactions, which run on behalf of the thread that registered them.
     */
    Object callAs(JSThread owner, Context cx, Scriptable scope, Callable fn, Scriptable thisObj, Object[] args) {
        var previous = current;
        current = new Strand(owner, false);
        try {
            return fn.call(cx, scope, thisObj, args);
        } finally {
            current = previous;
        }
    }

    // ------------------------------------------------------------------ unhandled rejections

    /** Enable unhandled-rejection tracking; {@code then} is the original {@code Promise.prototype.then}. */
    void trackPromises(Callable then) {
        promiseThen = then;
    }

    /** A promise was created (by the {@code Promise} constructor, see {@link JSPromises}): it belongs to this thread. */
    void promiseCreated(Scriptable promise) {
        if (promiseThen != null && !trackingSuppressed) freshPromises.add(new Candidate(promise, currentThread()));
    }

    /** A handler was attached to {@code promise}, so its rejection is handled. */
    void promiseHandled(Scriptable promise) {
        handledPromises.add(promise);
    }

    /**
     * Report rejections that have no handler once the microtask queue is empty, as Node does at the end of a
     * microtask checkpoint, and start watching the promises created since the last check.
     *
     * <ul>
     *   <li>A promise created by a thread that has been stopped is never reported: its work is discarded.</li>
     *   <li>If the creating thread is still running (and is not the root thread), it fails with
     *   {@code Error("Unhandled promise rejection: …")} — like Node ≥ 15, which exits the process. An async program
     *   that lost an error would otherwise go on half-dead; failing it ends it like any uncaught error, and the shell
     *   prints the error.</li>
     *   <li>Otherwise (the root thread — bios and shell — or a thread that has already returned) the error is emitted
     *   as the {@value #UNHANDLED_REJECTION_EVENT} event, which the shell prints.</li>
     * </ul>
     *
     * <p>Watching a promise means attaching a reaction through the original {@code then}, without marking it handled.
     * Promises with a handler at the end of the drain they were created in are never watched, so the overhead only
     * applies to fire-and-forget promises.
     */
    private MachineResult checkRejections(Context cx, Scriptable scope) {
        if (!rejections.isEmpty()) {
            var pending = new ArrayList<>(rejections);
            rejections.clear();
            for (var rejection : pending) {
                if (handledPromises.contains(rejection.promise()) || rejection.owner().isDead()) continue;
                var error = rejectionError(cx, scope, rejection.reason());
                var owner = rejection.owner();
                if (!owner.isRoot() && owner.state == JSThread.State.RUNNING) {
                    threadFailed(owner, error);
                } else {
                    var r = emit(cx, scope, UNHANDLED_REJECTION_EVENT, new Object[]{ error });
                    if (r.isError()) return r;
                }
            }
        }

        var then = promiseThen;
        if (then != null && !freshPromises.isEmpty()) {
            var fresh = new ArrayList<>(freshPromises);
            freshPromises.clear();
            for (var candidate : fresh) {
                if (handledPromises.contains(candidate.promise())) continue;
                var watcher = new RejectionWatcher(candidate);
                ScriptRuntime.setFunctionProtoAndParent(watcher, cx, scope);
                trackingSuppressed = true; // the reaction's own derived promise is not a candidate
                try {
                    then.call(cx, scope, candidate.promise(), new Object[]{ Undefined.instance, watcher });
                } finally {
                    trackingSuppressed = false;
                }
            }
        }
        return MachineResult.OK;
    }

    /** The reaction watching a candidate promise: records its rejection for {@link #checkRejections}. */
    @SuppressWarnings("serial") // never serialized
    private final class RejectionWatcher extends BaseFunction {
        private static final long serialVersionUID = 1L;

        private final Candidate candidate;

        RejectionWatcher(Candidate candidate) {
            this.candidate = candidate;
        }

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            rejections.add(new Rejection(candidate.promise(), candidate.owner(), args.length > 0 ? args[0] : Undefined.instance));
            return Undefined.instance;
        }
    }

    /**
     * The error an unhandled rejection is reported with: {@code Error("Unhandled promise rejection: <message>")}, with
     * the reason as its {@code cause} and the reason's stack (so the location points at the original error).
     */
    private static Scriptable rejectionError(Context cx, Scriptable scope, @Nullable Object reason) {
        String description;
        try {
            var message = reason instanceof Scriptable s ? ScriptableObject.getProperty(s, "message") : null;
            description = message instanceof CharSequence m ? m.toString() : ScriptRuntime.toString(reason);
        } catch (RhinoException e) {
            description = "(unprintable reason)";
        }
        var error = newError(cx, scope, "Error", "Unhandled promise rejection: " + description);
        ScriptableObject.putProperty(error, "cause", reason);
        if (reason instanceof Scriptable s && ScriptableObject.getProperty(s, "stack") instanceof CharSequence stack) {
            ScriptableObject.putProperty(error, "stack", stack.toString());
        }
        return error;
    }

    /** Remember that the safepoint aborted the machine (see {@link #abort}). */
    JSAbort noteAbort(JSAbort abort) {
        if (this.abort == null) this.abort = abort;
        return abort;
    }

    // ------------------------------------------------------------------ phase execution

    /** Run the bios script as the root thread. */
    MachineResult runBios(Context cx, Scriptable scope, Script bios) {
        return run(cx, scope, new Strand(root, true), () -> cx.executeScriptWithContinuations(bios, scope));
    }

    /**
     * Invoke the {@code events.on} listeners for a queued {@code event}, each as a strand of the thread that registered
     * it. Each is entered from the event loop, so it may block. See {@link #dispatchNow} for synchronous delivery.
     */
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
     * Invoke the {@code events.on} listeners for {@code event} synchronously, from inside running JS
     * ({@link JSEventEmitter#fireNow}, {@code events/promises.emit}; the blocking {@code events.emit} uses {@link #emitPlan}). Each listener runs as the thread that registered it, as in
     * {@link #emit}, but is called directly rather than entered from the event loop: no continuation can be captured
     * there, so a listener that tries to block fails with the usual "cannot be used inside callbacks run by native
     * code" error.
     *
     * <p>An error in a listener owned by the calling thread or one of its ancestors (always the case for listeners of
     * the root thread) is thrown to the caller, as Node's {@code emit} does: failing the owner would kill the caller
     * anyway, so it gets the chance to handle the error. The remaining listeners are then skipped. An error in a
     * listener of an unrelated thread fails that thread, exactly as in normal dispatch, and the remaining listeners
     * still run.
     *
     * @return Whether there were listeners (of running threads) for the event.
     */
    boolean dispatchNow(Context cx, Scriptable scope, String event, Object[] jsArgs) {
        var any = false;
        for (var entry : emitter.take(event)) {
            if (entry.owner().isDead()) continue;
            any = true;
            var owner = entry.owner().effective();
            var caller = currentThread();
            try {
                callAs(owner, cx, scope, entry.fn(), scope, jsArgs);
            } catch (JSAbort e) {
                throw noteAbort(e);
            } catch (RhinoException e) {
                if (isSelfOrAncestor(owner, caller)) throw e;
                threadFailed(owner, errorValue(cx, scope, e));
            }
        }
        return any;
    }

    /**
     * The listeners {@code events.emit} (the JS function of {@link JSEventEmitter#installEmit}) calls for
     * {@code event}, as a JS array in registration order. {@code once} listeners are removed now.
     *
     * <ul>
     *   <li>A listener owned by the calling thread or one of its ancestors is returned as is: {@code emit} calls it
     *   directly, so it runs as part of the caller's strand and may block, blocking the caller. That is the caller's
     *   own lineage: the ancestor is waiting for the caller (or runs it in the background) and is killed along with
     *   it, or before it. Work the listener starts belongs to the caller; Ctrl+T or stopping the caller reaches a
     *   blocked listener like any blocking call of the caller, and the error propagates out of {@code emit}.</li>
     *   <li>A listener of an unrelated thread is returned wrapped in a {@link ForeignListener}, which runs it as its
     *   owner, from Java: like normal dispatch, it cannot block (it gets the usual "cannot be used inside callbacks
     *   run by native code" error) and an error fails its owner instead of reaching the caller.</li>
     * </ul>
     */
    Scriptable emitPlan(Context cx, Scriptable scope, String event) {
        var caller = currentThread();
        var listeners = new ArrayList<Object>();
        for (var entry : emitter.take(event)) {
            if (entry.owner().isDead()) continue;
            var owner = entry.owner().effective();
            if (isSelfOrAncestor(owner, caller)) {
                listeners.add(entry.fn());
            } else {
                var foreign = new ForeignListener(owner, entry.fn());
                ScriptRuntime.setFunctionProtoAndParent(foreign, cx, scope);
                listeners.add(foreign);
            }
        }
        return cx.newArray(scope, listeners.toArray());
    }

    /** A listener of a thread unrelated to the caller of {@code events.emit}: see {@link #emitPlan}. */
    @SuppressWarnings("serial") // never serialized
    private final class ForeignListener extends BaseFunction {
        private static final long serialVersionUID = 1L;

        private final JSThread owner;
        private final Callable fn;

        ForeignListener(JSThread owner, Callable fn) {
            this.owner = owner;
            this.fn = fn;
        }

        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            // An earlier listener may have stopped the owner.
            if (owner.isDead()) return Undefined.instance;
            try {
                callAs(owner, cx, scope, fn, scope, args);
            } catch (JSAbort e) {
                throw noteAbort(e);
            } catch (RhinoException e) {
                threadFailed(owner, errorValue(cx, scope, e));
            }
            return Undefined.instance;
        }
    }

    private static boolean isSelfOrAncestor(JSThread candidate, JSThread thread) {
        for (@Nullable JSThread t = thread; t != null; t = t.parent) {
            if (t == candidate) return true;
        }
        return false;
    }

    /**
     * Phase 1: resume the {@code os.sleep()} continuation waiting for {@code timerId}, if any.
     * Automatically drains the run queue and microtasks afterward (Phase 3).
     */
    MachineResult drainTimers(Context cx, Scriptable scope, int timerId) {
        var parked = timerMap.remove(timerId);
        if (parked == null) return MachineResult.OK;
        var result = resume(cx, scope, parked.strand(), parked.waiter(), Undefined.instance);
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
                    if (entry.waiter() instanceof Waiter.Blocked blocked) blocked.pending().setApplicationState(newMr);
                    ioMap.computeIfAbsent(filterOf(newMr), k -> new ArrayList<>())
                         .add(new IOEntry(entry.strand(), entry.waiter(), newMr));
                    continue;
                }
                // Callback chain complete — wake the waiter with its result. Objects handed to a /promises call get
                // promise-returning methods too.
                jsResult = entry.waiter() instanceof Waiter.Promised
                    ? JSObjects.forPromises(cx, () -> JSValues.toJsResult(cx, scope, newMr.getResult()))
                    : JSValues.toJsResult(cx, scope, newMr.getResult());
            } catch (ScriptException e) {
                // The call failed — a blocking call throws this error at its call site (see JSCallShim), a promise
                // rejects with it. Either way it carries the exception's extra properties (e.g. fs `code`).
                jsResult = shim.failureWith(cx, scope, JSErrors.newError(cx, scope, e));
            } catch (RuntimeException e) {
                // A bug in the native callback: as in JSMethodBridge, log it but don't leak Java details to scripts.
                LOG.error("Unexpected exception in native callback", e);
                jsResult = shim.failure(cx, scope, JSMethodBridge.INTERNAL_ERROR_MESSAGE);
            }
            var r = resume(cx, scope, entry.strand(), entry.waiter(), jsResult);
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
     * Phase 3: work through the run queue (starting threads, resuming {@code waitFor*} and {@code async.unwrap}
     * callers, settling promises) and drain all queued JS microtask callbacks ({@code queueMicrotask}) and promise
     * jobs. Work queued while draining is also processed before returning (standard browser/Node.js behaviour for
     * microtasks). Called automatically after every other phase. {@code os.yield()} continuations are <em>not</em>
     * drained here — they run in Phase 4.
     */
    MachineResult drainMicrotasks(Context cx, Scriptable scope) {
        while (true) {
            var item = ready.poll();
            if (item != null) {
                var r = runReady(cx, scope, item);
                if (r.isError()) return r;
                continue;
            }

            var micro = microtaskQueue.poll();
            if (micro == null) {
                // The queue is empty: report unhandled rejections, which may queue more work (failing a thread,
                // running listeners, watching new promises).
                var r = checkRejections(cx, scope);
                if (r.isError()) return r;
                if (ready.isEmpty() && microtaskQueue.isEmpty()) return MachineResult.OK;
                continue;
            }
            var r = switch (micro) {
                case Task task -> task.owner().isDead() ? MachineResult.OK : run(cx, scope, new Strand(task.owner(), false),
                    () -> cx.callFunctionWithContinuations(task.fn(), scope, NO_ARGS));
                case Job job -> runJob(cx, scope, job);
            };
            if (r.isError()) return r;
        }
    }

    /**
     * Run a promise job. Jobs are never dropped: each reaction checks its own owner (see {@link JSPromises}), and a
     * job queued by a thread that has since been stopped (e.g. a settlement another thread waits for) runs as the root
     * thread.
     */
    private MachineResult runJob(Context cx, Scriptable scope, Job job) {
        var owner = job.owner().isDead() ? root : job.owner();
        promiseJobDepth++;
        try {
            return run(cx, scope, new Strand(owner, false), job.job()::run);
        } finally {
            promiseJobDepth--;
        }
    }

    private MachineResult runReady(Context cx, Scriptable scope, Ready item) {
        return switch (item) {
            case Start start -> isDead(start) ? MachineResult.OK : run(cx, scope, new Strand(start.thread(), true),
                () -> cx.callFunctionWithContinuations(start.fn(), scope, NO_ARGS));
            case Resume resume -> {
                if (isDead(resume)) yield MachineResult.OK;
                var value = resume.fail() ? shim.failureWith(cx, scope, resume.value()) : resume.value();
                yield resume(cx, scope, resume.strand(), resume.waiter(), value);
            }
            case Cancel cancel -> run(cx, scope, new Strand(root, false), () -> cancel.waiter().reject().call(
                cx, scope, scope, new Object[]{ newError(cx, scope, "Error", TERMINATED) }));
        };
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
            var r = resume(cx, scope, parked.strand(), parked.waiter(), Undefined.instance);
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
     * Wake {@code waiter} with {@code jsResult} (possibly a {@link JSCallShim} failure marker). A blocked call's
     * continuation is resumed — if it blocks again it is parked again through {@link #park} — and a promise is
     * resolved, or rejected with the marker's error.
     */
    private MachineResult resume(Context cx, Scriptable scope, Strand strand, Waiter waiter, Object jsResult) {
        return switch (waiter) {
            case Waiter.Blocked blocked ->
                run(cx, scope, strand, () -> cx.resumeContinuation(blocked.pending().getContinuation(), scope, jsResult));
            case Waiter.Promised promised -> run(cx, scope, strand, () -> {
                if (jsResult instanceof Scriptable marker && shim.isFailure(marker)) {
                    promised.reject().call(cx, scope, scope, new Object[]{ shim.errorOf(marker) });
                } else {
                    promised.resolve().call(cx, scope, scope, new Object[]{ jsResult });
                }
            });
        };
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
            return checkAbort(MachineResult.OK);
        } catch (ContinuationPending pending) {
            park(cx, scope, strand, pending);
            return checkAbort(MachineResult.OK);
        } catch (RuntimeException e) {
            return checkAbort(uncaught(cx, scope, strand, e));
        } finally {
            current = previous;
        }
    }

    /** An abort noted while JS ran (see {@link #abort}) always stops the machine, even if a promise swallowed it. */
    private MachineResult checkAbort(MachineResult result) {
        var abort = this.abort;
        return abort != null ? abort.result() : result;
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
    static Object errorValue(Context cx, Scriptable scope, RuntimeException e) {
        if (e instanceof JavaScriptException js) return js.getValue();
        if (e instanceof EcmaError ecma) return newError(cx, scope, ecma.getName(), ecma.getErrorMessage());
        if (e instanceof WrappedException wrapped) {
            var inner = wrapped.getWrappedException();
            return newError(cx, scope, "Error", inner.getMessage() != null ? inner.getMessage() : inner.toString());
        }
        if (e instanceof RhinoException rhino) return newError(cx, scope, "Error", rhino.details());
        return newError(cx, scope, "Error", e.getMessage() != null ? e.getMessage() : e.toString());
    }

    static Scriptable newError(Context cx, Scriptable scope, String constructor, String message) {
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
     * Timers, I/O continuations and parked {@code waitFor*} / {@code async.unwrap} callers are excluded — they are
     * woken by real CC events ({@code timer}, etc.), by the threads they wait for or by promise jobs.
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
        awaiting.clear();
        promiseGroups.clear();
        freshPromises.clear();
        rejections.clear();
    }
}
