// Copyright Daniel Ratcliffe, 2011-2022. This API may be redistributed unmodified and in full only.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.api.scripting;

import org.checkerframework.checker.nullness.qual.MonotonicNonNull;
import org.jspecify.annotations.Nullable;

final class TaskCallback implements ICallback, ScriptTask {
    private final ScriptTask task;

    private volatile @Nullable Object result;
    private volatile @MonotonicNonNull ScriptException failure;

    private final long taskId;
    private final MethodResult pull = MethodResult.pullEvent("task_complete", this);

    private TaskCallback(IContext context, ScriptTask task) throws ScriptException {
        this.task = task;
        taskId = context.issueMainThreadTask(this);
    }

    @Override
    public @Nullable Object execute() throws ScriptException {
        // Store the result/exception: we read these back when receiving the task_complete event.
        try {
            result = task.execute();
            return null;
        } catch (ScriptException e) {
            // We only care about storing LuaExceptions as we want also want to preserve custom error levels: other
            // exceptions won't have this extra data!
            failure = e;
            throw e;
        }
    }

    @Override
    public MethodResult resume(@Nullable Object[] response) throws ScriptException {
        if (response.length < 3 || !(response[1] instanceof Number eventTask) || !(response[2] instanceof Boolean isOk)) {
            return pull;
        }

        if (eventTask.longValue() != taskId) return pull;

        if (isOk) {
            return MethodResult.of(result);
        } else if (failure != null) {
            throw failure;
        } else if (response.length >= 4 && response[3] instanceof String message) {
            throw new ScriptException(message);
        } else {
            throw new ScriptException("error");
        }
    }

    static MethodResult make(IContext context, ScriptTask func) throws ScriptException {
        return new TaskCallback(context, func).pull;
    }
}
