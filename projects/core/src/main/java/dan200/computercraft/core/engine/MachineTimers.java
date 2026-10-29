// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

/**
 * The computer's game-tick timers, as used by the JS timers ({@code setTimeout} &amp; co., see {@link JSTimers}).
 *
 * <p>These are the same timers as {@code system.startTimer}: a timer started for {@code n} ticks queues a
 * {@code timer} event carrying its {@linkplain Started#id() id} {@code n} game ticks later. Unlike
 * {@code system.startTimer}, {@link #start} also reports the tick the timer fires on, on a clock that advances by one
 * every game tick. Timers that expire in the same game tick queue their events in no particular order, so the JS
 * timers use the due tick to run their callbacks in due-time order.
 *
 * @see dan200.computercraft.core.computer.Environment
 */
public interface MachineTimers {
    /**
     * A started timer.
     *
     * @param id  The id the {@code timer} event will carry.
     * @param due The tick (of the computer's tick clock) the timer fires on.
     */
    record Started(int id, long due) {
    }

    /**
     * Start a timer.
     *
     * @param ticks The number of game ticks until it fires, at least 1.
     * @return The timer's id and due tick, read atomically.
     */
    Started start(long ticks);

    /**
     * Cancel a timer. Its event may already be queued if it has expired.
     *
     * @param id The timer's id.
     */
    void cancel(int id);

    /** Timers for machines that have none (e.g. tests): starting one fails. */
    MachineTimers NONE = new MachineTimers() {
        @Override
        public Started start(long ticks) {
            throw new UnsupportedOperationException("This machine has no timers");
        }

        @Override
        public void cancel(int id) {
        }
    };
}
