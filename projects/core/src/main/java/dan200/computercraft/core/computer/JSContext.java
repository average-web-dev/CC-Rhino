// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.lua.ILuaContext;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.LuaTask;
import dan200.computercraft.api.lua.MethodResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * {@link ILuaContext} for the JS machine.
 * <p>
 * Unlike {@link LuaContext}, which uses the CC event system ({@code task_complete}), this implementation
 * blocks the computer thread directly on a {@link CompletableFuture}, allowing JS async/await to resolve
 * synchronously from JavaScript's perspective.
 */
public class JSContext implements ILuaContext {
    private static final Logger LOG = LoggerFactory.getLogger(JSContext.class);

    /** Maximum time (ms) to wait for a main-thread task before giving up. */
    private static final long TASK_TIMEOUT_MS = 30_000;

    private final Computer computer;

    public JSContext(Computer computer) {
        this.computer = computer;
    }

    @Override
    public long issueMainThreadTask(LuaTask task) throws LuaException {
        // Identical to LuaContext: queue the task and fire task_complete when done.
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
            } catch (Exception e) {
                LOG.error("Error running task", e);
                computer.queueEvent("task_complete", new Object[]{ taskID, false, "Java Exception Thrown: " + e });
            }
        };
        if (computer.queueMainThread(iTask)) {
            return taskID;
        } else {
            throw new LuaException("Task limit exceeded");
        }
    }

    /**
     * Executes a main-thread task and blocks the computer thread until it completes.
     * <p>
     * This bypasses the event-based {@code task_complete} mechanism used by {@link LuaContext},
     * allowing Java methods called from JS to return results synchronously.
     */
    @Override
    public MethodResult executeMainThreadTask(LuaTask task) throws LuaException {
        var future = new CompletableFuture<Object[]>();

        boolean queued = computer.queueMainThread(() -> {
            try {
                var result = task.execute();
                future.complete(result != null ? result : new Object[0]);
            } catch (LuaException e) {
                future.completeExceptionally(e);
            } catch (Exception e) {
                LOG.error("Error running main-thread task", e);
                future.completeExceptionally(new LuaException("Java Exception Thrown: " + e));
            }
        });

        if (!queued) throw new LuaException("Task limit exceeded");

        try {
            var result = future.get(TASK_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            return MethodResult.of(result);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof LuaException le) throw le;
            throw new LuaException("Java Exception Thrown: " + e.getCause());
        } catch (TimeoutException e) {
            throw new LuaException("Main thread task timed out");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LuaException("Interrupted");
        }
    }
}
