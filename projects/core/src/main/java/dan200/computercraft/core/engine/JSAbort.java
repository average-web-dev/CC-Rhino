// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.core.computer.TimeoutState;
import org.mozilla.javascript.EvaluatorException;

/**
 * Thrown by the instruction-count safepoint ({@code JSMachine.CCContextFactory#observeInstructionCount}) when the
 * computer has run for too long without yielding.
 *
 * <p>Scripts cannot recover from it: Rhino does not reset its instruction counter when the observer throws, so every
 * following branch and exception handler re-enters the observer, which throws again before any JS {@code catch}
 * block can run (only {@code finally} blocks do). Wherever it surfaces, the event loop maps it to a
 * {@link MachineResult} through {@link #result()}.
 */
final class JSAbort extends EvaluatorException {
    private static final long serialVersionUID = 1L;

    private final boolean hard;

    private JSAbort(String message, boolean hard) {
        super(message);
        this.hard = hard;
    }

    /** The computer must stop now (hard abort or the machine was closed). */
    static JSAbort hard() {
        return new JSAbort(TimeoutState.ABORT_MESSAGE, true);
    }

    /** The computer ran past its time slice (soft abort). */
    static JSAbort soft() {
        return new JSAbort(TimeoutState.ABORT_MESSAGE, false);
    }

    /** The result the machine reports when this abort ends the current execution. */
    MachineResult result() {
        return hard ? MachineResult.TIMEOUT : MachineResult.error(TimeoutState.ABORT_MESSAGE);
    }
}
