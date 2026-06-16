// Copyright Daniel Ratcliffe, 2011-2022. This API may be redistributed unmodified and in full only.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

/**
 * A task which can be executed via {@link IContext#issueMainThreadTask(ScriptTask)} This will be run on the main
 * thread, at the beginning of the
 * next tick.
 *
 * @see IContext#issueMainThreadTask(ScriptTask)
 */
@FunctionalInterface
public interface ScriptTask {
    /**
     * Execute this task.
     *
     * @return The single value to return from the task (added to the {@code task_complete} event). To return several
     *         things, return an array/{@link java.util.Collection}/{@link java.util.Map}.
     * @throws ScriptException If you throw any exception from this function, a script error will be raised with the
     *                      same message as your exception. Use this to throw appropriate errors if the wrong
     *                      arguments are supplied to your method.
     */
    @Nullable Object execute() throws ScriptException;
}
