// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;

import java.io.IOException;
import java.io.InputStream;

/**
 * Represents a machine which executes computer programs. The only current implementation is {@link JSMachine}.
 */
public interface IMachine {
    /**
     * Resume the machine, either starting it or delivering the next event.
     * <p>
     * This should destroy the machine if it failed to execute successfully.
     *
     * @param eventName The name of the event. This is {@code null} when first starting the machine. Note, this may
     *                  do nothing if it does not match the event filter.
     * @param arguments The arguments for this event.
     * @return The result of this step. Will either be OK, or the error message that occurred when executing.
     */
    MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments);

    /**
     * Print some information about the internal execution state.
     * <p>
     * This function is purely intended for debugging, its output should not be relied on in any way.
     *
     * @param out The buffer to write to.
     */
    void printExecutionState(StringBuilder out);

    /**
     * Close the machine, aborting any running functions and deleting the internal state.
     */
    void close();

    interface Factory {
        /**
         * Attempt to create a machine.
         *
         * @param environment The environment under which to create the machine.
         * @param bios        The {@link InputStream} which contains the initial script to run. This should be used to
         *                    load the script - it should <em>NOT</em> be executed.
         * @return The successfully created machine, or an error.
         * @throws IOException      If reading the underlying {@link InputStream} failed.
         * @throws MachineException An error occurred while creating the machine.
         */
        IMachine create(MachineEnvironment environment, InputStream bios) throws IOException, MachineException;
    }
}
