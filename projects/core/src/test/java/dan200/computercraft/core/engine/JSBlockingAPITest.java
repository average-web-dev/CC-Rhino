// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptTask;
import dan200.computercraft.api.scripting.TaskCompletion;
import dan200.computercraft.core.methods.ApiMethod;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
            context.executeMainThreadTask(() -> true));
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

    /** A module whose {@code wait(id)} parks until {@code task_complete} fires for {@code id}. */
    private static Map<String, ApiMethod> awaitingTask() {
        return Map.of("wait", (target, context, args) -> TaskCompletion.await(args.getLong(0)));
    }

    @Test
    void failed_task_throws_catchable_error_at_call_site() throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("t", awaitingTask())
            .api(rec, rec.methods())
            .bios("""
                var p = require('probe');
                try {
                    require('t').wait(7);
                    p.record('ok');
                } catch (e) {
                    p.record('caught');
                    p.record(e instanceof Error);
                    p.record(e.message);
                }
                p.record('after');
                """)
            .build();
        try {
            assertFalse(machine.handleEvent(null, null).isError(), "boot should succeed");
            var result = machine.handleEvent("task_complete", new Object[]{ 7L, false, "boom" });
            assertFalse(result.isError(), "a caught failure must not stop the machine: " + result.getMessage());
            assertEquals(List.of("caught", true, "boom", "after"), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void uncaught_failed_task_stops_machine_with_message() throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("t", awaitingTask())
            .api(rec, rec.methods())
            .bios("""
                require('t').wait(7);
                require('probe').record('ok');
                """)
            .build();
        try {
            assertFalse(machine.handleEvent(null, null).isError(), "boot should succeed");
            var result = machine.handleEvent("task_complete", new Object[]{ 7L, false, "boom" });
            assertTrue(result.isError(), "an uncaught failure should stop the machine");
            assertTrue(String.valueOf(result.getMessage()).contains("boom"), "unexpected message: " + result.getMessage());
            assertEquals(List.of(), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void failed_task_leaves_other_parked_calls_intact() throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("t", awaitingTask())
            .api("events", Map.of())
            .api(rec, rec.methods())
            .bios("""
                var t = require('t');
                var events = require('events');
                var p = require('probe');
                events.on('go', function () {
                    try { t.wait(7); p.record('a:ok'); } catch (e) { p.record('a:' + e.message); }
                });
                events.on('go', function () { p.record('b:' + t.wait(8)); });
                """)
            .build();
        try {
            assertFalse(machine.handleEvent(null, null).isError(), "boot should succeed");
            assertFalse(machine.handleEvent("go", new Object[0]).isError(), "listeners should park");
            assertEquals(List.of(), rec.values);

            var failed = machine.handleEvent("task_complete", new Object[]{ 7L, false, "boom" });
            assertFalse(failed.isError(), "a caught failure must not stop the machine: " + failed.getMessage());
            assertEquals(List.of("a:boom"), rec.values, "only the failed call should resume");

            var done = machine.handleEvent("task_complete", new Object[]{ 8L, true, "v" });
            assertFalse(done.isError(), "resume should succeed: " + done.getMessage());
            assertEquals(List.of("a:boom", "b:v"), rec.values, "the other call should still resume normally");
        } finally {
            machine.close();
        }
    }
}
