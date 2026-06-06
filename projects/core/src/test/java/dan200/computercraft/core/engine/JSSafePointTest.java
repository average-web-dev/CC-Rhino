// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.core.computer.TimeoutState;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Phase 8.6 — a tight JS loop ({@code while(true){}}) is interrupted by the instruction-count safepoint
 * ({@code CCContextFactory.observeInstructionCount}) once the {@link TimeoutState} is aborted, returning within a
 * bounded time rather than hanging the computer thread.
 */
class JSSafePointTest {
    /** A timeout whose abort flags can be flipped from another thread mid-execution. */
    private static final class FlippableTimeout extends TimeoutState {
        @Override
        public void refresh() {
        }

        synchronized void triggerHardAbort() {
            hardAbort = true;
            updateListeners();
        }

        synchronized void triggerSoftAbort() {
            softAbort = true;
            updateListeners();
        }
    }

    @Test
    void infinite_loop_is_hard_aborted() {
        assertTimeoutPreemptively(Duration.ofSeconds(10), () -> {
            var timeout = new FlippableTimeout();
            var machine = new JSMachineBuilder().bios("while (true) {}").timeout(timeout).build();
            try {
                var flipper = new Thread(() -> {
                    sleep(100);
                    timeout.triggerHardAbort();
                });
                flipper.start();

                var result = machine.handleEvent(null, null);
                flipper.join();

                assertTrue(result.isError(), "infinite loop should be aborted");
                assertEquals(MachineResult.TIMEOUT, result, "hard abort should map to TIMEOUT");
            } finally {
                machine.close();
            }
        });
    }

    @Test
    void infinite_loop_is_soft_aborted() {
        assertTimeoutPreemptively(Duration.ofSeconds(10), () -> {
            var timeout = new FlippableTimeout();
            var machine = new JSMachineBuilder().bios("while (true) {}").timeout(timeout).build();
            try {
                var flipper = new Thread(() -> {
                    sleep(100);
                    timeout.triggerSoftAbort();
                });
                flipper.start();

                var result = machine.handleEvent(null, null);
                flipper.join();

                assertTrue(result.isError(), "infinite loop should be aborted");
                assertEquals(TimeoutState.ABORT_MESSAGE, result.getMessage(), "soft abort should use the abort message");
            } finally {
                machine.close();
            }
        });
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
