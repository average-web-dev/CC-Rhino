// Copyright Daniel Ratcliffe, 2011-2022. This API may be redistributed unmodified and in full only.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.api.scripting;

/**
 * An interface passed to peripherals and {@link IDynamicObject}s by computers or turtles, providing methods
 * that allow the peripheral call to interface with the computer.
 */
public interface IContext {
    /**
     * Queue a task to be executed on the main server thread at the beginning of next tick, but do not wait for it to
     * complete. This should be used when you need to interact with the world in a thread-safe manner but do not care
     * about the result or you wish to run asynchronously.
     * <p>
     * When the task has finished, it will enqueue a {@code task_completed} event, which takes the task id, a success
     * value and the return values, or an error message if it failed.
     *
     * @param task The task to execute on the main thread.
     * @return The "id" of the task. This will be the first argument to the {@code task_completed} event.
     * @throws ScriptException If the task could not be queued.
     * @see ScriptFunction#mainThread() To run functions on the main thread and return their results synchronously.
     */
    long issueMainThreadTask(ScriptTask task) throws ScriptException;

    /**
     * Queue a task to be executed on the main server thread at the beginning of next tick, waiting for it to complete.
     * This should be used when you need to interact with the world in a thread-safe manner.
     * <p>
     * Note that the return values of your task are handled as events, meaning more complex objects such as maps or
     * {@link IDynamicObject} will not preserve their identities.
     *
     * @param task The task to execute on the main thread.
     * @return The objects returned by {@code task}.
     * @throws ScriptException If the task could not be queued, or if the task threw an exception.
     */
    default MethodResult executeMainThreadTask(ScriptTask task) throws ScriptException {
        return TaskCallback.make(this, task);
    }
}
