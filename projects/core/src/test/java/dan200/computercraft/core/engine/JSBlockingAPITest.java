// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptTask;
import dan200.computercraft.core.methods.ApiMethod;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Phase 8.3 — a blocking API method (one that issues a main-thread task) suspends JS via a Rhino continuation on the
 * first {@code handleEvent}, then resumes from the call site with the task result when {@code task_complete} fires.
 */
class JSBlockingAPITest {
    /**
     * A context that runs each task immediately (simulating the main thread) and hands back an incrementing task id.
     * The result is stored on the {@code TaskCallback} so the {@code task_complete} resume returns it to JS.
     */
    private static final class ImmediateContext implements IContext {
        long lastTaskId = 0;

        @Override
        public long issueMainThreadTask(ScriptTask task) throws ScriptException {
            task.execute();
            return ++lastTaskId;
        }
    }

    private static Map<String, ApiMethod> diggingTurtle() {
        // turtle.dig() queues a main-thread task that returns `true`, then yields until task_complete.
        return Map.of("dig", (target, context, args) ->
            context.executeMainThreadTask(() -> new Object[]{ true }));
    }

    @Test
    void blocking_call_suspends_then_resumes_with_result() throws Exception {
        var ctx = new ImmediateContext();
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .context(ctx)
            .api("turtle", diggingTurtle())
            .api(rec, rec.methods())
            .bios("""
                var turtle = require('turtle');
                var probe = require('probe');
                probe.record("before");
                var ok = turtle.dig();
                probe.record(ok);
                """)
            .build();
        try {
            // Boot: dig() yields, so only the code before it has run. The continuation is now pending.
            var boot = machine.handleEvent(null, null);
            assertFalse(boot.isError(), "boot should succeed: " + boot.getMessage());
            assertEquals(List.of("before"), rec.values, "dig() should suspend before returning");

            // task_complete resumes the continuation; dig() returns true from its call site.
            var resumed = machine.handleEvent("task_complete", new Object[]{ ctx.lastTaskId, true });
            assertFalse(resumed.isError(), "resume should succeed: " + resumed.getMessage());
            assertEquals(List.of("before", true), rec.values, "dig() should resume with the task result");
        } finally {
            machine.close();
        }
    }

    @Test
    void unrelated_task_id_does_not_resume() throws Exception {
        var ctx = new ImmediateContext();
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .context(ctx)
            .api("turtle", diggingTurtle())
            .api(rec, rec.methods())
            .bios("""
                var turtle = require('turtle');
                var probe = require('probe');
                var ok = turtle.dig();
                probe.record(ok);
                """)
            .build();
        try {
            machine.handleEvent(null, null);
            // A task_complete for a different task id must not resume our continuation.
            var result = machine.handleEvent("task_complete", new Object[]{ ctx.lastTaskId + 99, true });
            assertFalse(result.isError(), "mismatched task_complete should be ignored: " + result.getMessage());
            assertEquals(List.of(), rec.values, "dig() must stay suspended for a non-matching task id");
        } finally {
            machine.close();
        }
    }
}
