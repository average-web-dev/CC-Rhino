// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.Callable;
import org.mozilla.javascript.ContinuationPending;
import org.mozilla.javascript.Undefined;

import java.util.ArrayList;
import java.util.List;

/**
 * The threads started by one {@code parallel.waitForAll/waitForAny/waitForN} call, plus the caller's parked
 * continuation, which is resumed once the group settles.
 *
 * <p>A group settles when {@link #needed} of its threads have returned, or as soon as one of them fails. Either way the
 * threads still running are killed, so a finished {@code waitFor*} never leaves work behind.
 */
final class JSTaskGroup {
    enum Mode {
        /** {@code waitForAll}: resumes with {@code undefined}. */
        ALL,
        /** {@code waitForAny}: resumes with the index of the first thread to return. */
        ANY,
        /** {@code waitForN}: resumes with the number of threads that returned. */
        N,
    }

    /**
     * The application state of the continuation captured by a {@code waitFor*} call. The event loop turns it into a
     * group when it parks the continuation.
     */
    record Request(Mode mode, int needed, List<Callable> tasks) {
    }

    final Mode mode;
    final int needed;
    final Strand waiter;
    final ContinuationPending pending;
    final List<JSThread> threads = new ArrayList<>();

    private int returned = 0;
    private int first = -1;
    boolean settled = false;

    JSTaskGroup(Mode mode, int needed, Strand waiter, ContinuationPending pending) {
        this.mode = mode;
        this.needed = needed;
        this.waiter = waiter;
        this.pending = pending;
    }

    /** Record that {@code thread} returned. Returns {@code true} if the group is now complete. */
    boolean onReturned(JSThread thread) {
        returned++;
        if (first < 0) first = thread.index;
        return returned >= needed;
    }

    /** The value the waiting {@code waitFor*} call returns once the group is complete. */
    Object result() {
        return switch (mode) {
            case ALL -> Undefined.instance;
            case ANY -> first;
            case N -> returned;
        };
    }
}
