// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.LuaTask;
import dan200.computercraft.core.Logging;
import dan200.computercraft.core.filesystem.FileSystem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

class JSContext implements ILuaContext {
    private static final Logger LOG = LoggerFactory.getLogger(JSContext.class);
    private final Computer computer;

    JSContext(Computer computer) {
        this.computer = computer;
    }

    FileSystem getFileSystem() {
        return computer.getFileSystem();
    }

    @Override
    public long issueMainThreadTask(LuaTask task) throws LuaException {
        final var taskID = computer.getUniqueTaskId();
        final Runnable iTask = () -> {
            try {
                var results = task.execute();
                if (results != null) {
                    var eventArguments = new Object[results.length + 2];
                    eventArguments[0] = taskID;
                    eventArguments[1] = true;
                    System.arraycopy(results, 0, eventArguments, 2, results.length);
                    computer.queueEvent("task_complete", eventArguments);
                } else {
                    computer.queueEvent("task_complete", new Object[]{ taskID, true });
                }
            } catch (LuaException e) {
                computer.queueEvent("task_complete", new Object[]{ taskID, false, e.getMessage() });
            } catch (Exception t) {
                LOG.error(Logging.JAVA_ERROR, "Error running task", t);
                computer.queueEvent("task_complete", new Object[]{ taskID, false, "Java Exception Thrown: " + t });
            }
        };
        if (computer.queueMainThread(iTask)) {
            return taskID;
        } else {
            throw new LuaException("Task limit exceeded");
        }
    }
}
