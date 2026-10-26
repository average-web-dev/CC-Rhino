// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

/**
 * One stack of JS execution: a thread's own function ({@code main}), or a listener, microtask or {@code setImmediate}
 * callback run on behalf of a thread. Every continuation the event loop parks is tagged with the strand it belongs to,
 * and resuming it runs that strand again.
 *
 * @param thread The thread that owns this strand.
 * @param main   Whether this is the thread's own function. When a main strand completes, the thread has returned; when
 *               it is blocked, it is where {@code terminate} is delivered.
 */
record Strand(JSThread thread, boolean main) {
}
