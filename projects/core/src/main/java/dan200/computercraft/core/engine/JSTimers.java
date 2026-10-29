// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Callable;

import java.util.*;

/**
 * The timer queue behind Node's {@code setTimeout}/{@code setInterval} (#45). The ROM's {@code timers} module
 * ({@code /rom/lib/timers}) uses it through the engine-internal {@code internal/loop} module ({@link JSLoopModule}).
 *
 * <ul>
 *   <li>Every pending timer has its own CC timer ({@link MachineTimers}), so a pending timer costs nothing until it is
 *   due. An interval starts a new CC timer each time it fires.</li>
 *   <li>Like {@code events.on} listeners, a timer belongs to the thread that created it: its callback runs as a strand
 *   of that thread (so it may block), and stopping the thread discards its timers.</li>
 *   <li>Timers run in due-time order, timers due in the same tick in the order they were (re-)armed. CC queues the
 *   events of timers that expire in the same tick in no particular order, so when the first of them arrives, every
 *   timer due by then runs (see {@link EventLoop#drainJsTimers}); the events of the others are then ignored.</li>
 *   <li>A timer is <em>ref'd</em> (by default) or not. A ref'd pending timer keeps its thread busy, so a shell job
 *   stays alive while it has one, like a Node process (see {@link EventLoop#isIdle}).</li>
 * </ul>
 */
final class JSTimers {
    /** A pending timer. */
    static final class Timer {
        final int id;
        final JSThread owner;
        final Callable fn;
        final long ticks;
        final boolean repeat;
        boolean ref;
        long due;
        long seq;
        int ccId;

        Timer(int id, JSThread owner, Callable fn, long ticks, boolean repeat, boolean ref) {
            this.id = id;
            this.owner = owner;
            this.fn = fn;
            this.ticks = ticks;
            this.repeat = repeat;
            this.ref = ref;
        }

        @Override
        public String toString() {
            return "Timer#" + id + "[due " + due + "]";
        }
    }

    private static final Comparator<Timer> ORDER = Comparator.<Timer>comparingLong(t -> t.due).thenComparingLong(t -> t.seq);

    private final MachineTimers clock;
    private final Map<Integer, Timer> byId = new HashMap<>();
    private final Map<Integer, Timer> byCcId = new HashMap<>();
    private final TreeSet<Timer> queue = new TreeSet<>(ORDER);
    private int nextId = 1;
    private long nextSeq = 0;

    JSTimers(MachineTimers clock) {
        this.clock = clock;
    }

    /**
     * Add a timer.
     *
     * @param reuse An id to reuse (a {@code refresh} of a timer that has already fired), or 0 for a new one.
     * @return The timer's id.
     */
    int schedule(JSThread owner, Callable fn, long ticks, boolean repeat, boolean ref, int reuse) {
        var id = reuse > 0 && !byId.containsKey(reuse) ? reuse : nextId++;
        var timer = new Timer(id, owner, fn, Math.max(1, ticks), repeat, ref);
        byId.put(id, timer);
        arm(timer);
        return id;
    }

    private void arm(Timer timer) {
        var started = clock.start(timer.ticks);
        timer.ccId = started.id();
        timer.due = started.due();
        timer.seq = nextSeq++;
        byCcId.put(timer.ccId, timer);
        queue.add(timer);
    }

    private void disarm(Timer timer) {
        queue.remove(timer);
        byCcId.remove(timer.ccId);
        clock.cancel(timer.ccId);
    }

    /** Cancel a pending timer. Returns whether there was one. */
    boolean cancel(int id) {
        var timer = byId.remove(id);
        if (timer == null) return false;
        disarm(timer);
        return true;
    }

    /** Restart a pending timer's countdown from now. Returns whether it was pending. */
    boolean refresh(int id) {
        var timer = byId.get(id);
        if (timer == null) return false;
        disarm(timer);
        arm(timer);
        return true;
    }

    /** Set whether a pending timer keeps its job alive. */
    void setRef(int id, boolean ref) {
        var timer = byId.get(id);
        if (timer != null) timer.ref = ref;
    }

    /**
     * The tick up to which timers are due now that the CC timer {@code ccId} fired, or {@code -1} if it is not the CC
     * timer of a pending JS timer.
     */
    long dueBy(int ccId) {
        var timer = byCcId.get(ccId);
        return timer == null ? -1 : timer.due;
    }

    /**
     * Take the next timer due by {@code limit}, in due-time order. A one-shot timer is removed, an interval re-armed
     * (so it is due after {@code limit}: the clock has reached {@code limit} when its timer fires).
     */
    @Nullable Timer next(long limit) {
        if (queue.isEmpty()) return null;
        var timer = queue.first();
        if (timer.due > limit) return null;
        disarm(timer);
        if (timer.repeat) {
            arm(timer);
        } else {
            byId.remove(timer.id);
        }
        return timer;
    }

    /** Whether {@code thread} has a ref'd pending timer (see {@link EventLoop#isIdle}). */
    boolean hasRef(JSThread thread) {
        for (var timer : queue) {
            if (timer.ref && timer.owner.effective() == thread) return true;
        }
        return false;
    }

    /** Discard the timers of stopped threads. */
    void purge() {
        for (var timer : List.copyOf(queue)) {
            if (timer.owner.isDead()) cancel(timer.id);
        }
    }

    void clear() {
        for (var timer : queue) clock.cancel(timer.ccId);
        queue.clear();
        byId.clear();
        byCcId.clear();
    }
}
