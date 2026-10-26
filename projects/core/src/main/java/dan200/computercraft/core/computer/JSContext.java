// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptTask;
import dan200.computercraft.core.Logging;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.filesystem.FileSystem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

class JSContext implements IContext {
    private static final Logger LOG = LoggerFactory.getLogger(JSContext.class);
    private final Computer computer;

    JSContext(Computer computer) {
        this.computer = computer;
    }

    FileSystem getFileSystem() {
        return computer.getFileSystem();
    }

    @Override
    public long issueMainThreadTask(ScriptTask task) throws ScriptException {
        final var taskID = computer.getUniqueTaskId();
        final Runnable iTask = () -> {
            try {
                var result = task.execute();
                computer.queueEvent(new CoreEvents.TaskComplete(taskID, true, result));
            } catch (ScriptException e) {
                computer.queueEvent(new CoreEvents.TaskComplete(taskID, false, e.getMessage()));
            } catch (Exception t) {
                LOG.error(Logging.JAVA_ERROR, "Error running task", t);
                computer.queueEvent(new CoreEvents.TaskComplete(taskID, false, "Java Exception Thrown: " + t));
            }
        };
        if (computer.queueMainThread(iTask)) {
            return taskID;
        } else {
            throw new ScriptException("Task limit exceeded");
        }
    }
}
