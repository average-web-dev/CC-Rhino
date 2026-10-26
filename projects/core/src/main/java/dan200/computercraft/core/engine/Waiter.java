// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.ContinuationPending;
import org.mozilla.javascript.Function;

/**
 * Whatever is waiting for a parked operation (a sleep, an I/O wait, a yield, a {@code parallel.waitFor*} group, …) to
 * complete. The {@link EventLoop} wakes it with the operation's result, or with a failure marker built by
 * {@link JSCallShim} when the operation failed.
 */
sealed interface Waiter {
    /**
     * A blocking call: its continuation is resumed with the result, and a failure is thrown at the call site.
     *
     * @param pending The continuation captured by the call.
     */
    record Blocked(ContinuationPending pending) implements Waiter {
    }

    /**
     * A call made through a {@code <module>/promises} module: its promise is resolved with the result, or rejected
     * with the error the blocking form would have thrown.
     *
     * @param resolve The promise's resolve function.
     * @param reject  The promise's reject function.
     */
    record Promised(Function resolve, Function reject) implements Waiter {
    }
}
