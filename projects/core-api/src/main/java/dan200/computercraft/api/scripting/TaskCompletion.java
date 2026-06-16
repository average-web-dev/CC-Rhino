// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

/**
 * Parks a continuation until a {@code task_complete} event fires for a given task id, then resumes with the
 * value carried by that event.
 *
 * <p>This is the externally-completed counterpart to {@link TaskCallback}: where {@code TaskCallback} both
 * schedules a main-thread task <em>and</em> awaits its {@code task_complete} event, this awaits a
 * {@code task_complete} for a task whose work is driven elsewhere (e.g. a turtle command completed on the
 * turtle's own update tick). The id must come from the same space as main-thread task ids so the two never
 * cross-match.
 *
 * <p>The producer emits {@code queueEvent("task_complete", [taskId, true, value])} on completion — {@code value}
 * is returned to the caller — or {@code [taskId, false, message]} for a genuine error, which is rethrown.
 */
public final class TaskCompletion implements ICallback {
    private final long taskId;
    private final MethodResult pull = MethodResult.pullEvent("task_complete", this);

    private TaskCompletion(long taskId) {
        this.taskId = taskId;
    }

    @Override
    public MethodResult resume(@Nullable Object[] response) throws ScriptException {
        if (response.length < 3 || !(response[1] instanceof Number id) || !(response[2] instanceof Boolean ok)) {
            return pull;
        }
        if (id.longValue() != taskId) return pull;

        if (ok) return MethodResult.of(response.length >= 4 ? response[3] : null);
        throw new ScriptException(response.length >= 4 && response[3] instanceof String message ? message : "error");
    }

    /** Await the {@code task_complete} event for {@code taskId}, resuming with the value it carries. */
    public static MethodResult await(long taskId) {
        return new TaskCompletion(taskId).pull;
    }
}
