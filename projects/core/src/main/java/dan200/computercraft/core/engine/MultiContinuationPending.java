// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.ContinuationPending;

import java.util.List;

/**
 * Thrown by {@link JSEventEmitter#emit} when one or more event listeners captured a Rhino
 * continuation (i.e. called a blocking API like {@code turtle.forward()}).
 *
 * <p>Wrapping all captured continuations in a single exception lets the emit loop run every
 * listener before propagating, so non-blocking listeners are never skipped.
 */
final class MultiContinuationPending extends RuntimeException {
    private final List<ContinuationPending> continuations;

    MultiContinuationPending(List<ContinuationPending> continuations) {
        super(null, null, true, false); // suppress message + writable stacktrace — never inspected
        this.continuations = List.copyOf(continuations);
    }

    List<ContinuationPending> continuations() {
        return continuations;
    }
}
