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
     * @return The arguments to add to the {@code task_completed} event.
     * @throws ScriptException If you throw any exception from this function, a lua error will be raised with the
     *                      same message as your exception. Use this to throw appropriate errors if the wrong
     *                      arguments are supplied to your method.
     */
    @Nullable
    Object @Nullable [] execute() throws ScriptException;
}
