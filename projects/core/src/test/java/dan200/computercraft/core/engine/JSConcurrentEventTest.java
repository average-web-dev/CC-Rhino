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
 * Phase 8.4 — while a blocking call's continuation is pending (a dig in progress), unrelated events still dispatch to
 * their {@code os.on} listeners without resuming the suspended continuation.
 */
class JSConcurrentEventTest {
    private static final class ImmediateContext implements IContext {
        long lastTaskId = 0;

        @Override
        public long issueMainThreadTask(ScriptTask task) throws ScriptException {
            task.execute();
            return ++lastTaskId;
        }
    }

    @Test
    void event_fires_while_continuation_pending() throws Exception {
        var ctx = new ImmediateContext();
        var rec = new JSMachineBuilder.Recorder();
        Map<String, ApiMethod> turtle = Map.of("dig", (target, context, args) ->
            context.executeMainThreadTask(() -> new Object[]{ true }));

        var machine = new JSMachineBuilder()
            .context(ctx)
            .api("turtle", turtle)
            .api("events", Map.of())
            .api(rec, rec.methods())
            .bios("""
                var turtle = require('turtle');
                var events = require('events');
                var probe = require('probe');
                events.on("redstone", function () { probe.record("redstone"); });
                var ok = turtle.dig();
                probe.record("after:" + ok);
                """)
            .build();
        try {
            // Boot: dig() suspends. The redstone listener is registered; nothing has fired yet.
            assertFalse(machine.handleEvent(null, null).isError(), "boot should succeed");
            assertEquals(List.of(), rec.values);

            // redstone fires while dig is pending: the listener runs but the continuation must NOT resume.
            var redstone = machine.handleEvent("redstone", new Object[0]);
            assertFalse(redstone.isError(), "redstone dispatch should succeed: " + redstone.getMessage());
            assertEquals(List.of("redstone"), rec.values, "redstone listener should fire; dig must stay suspended");

            // Now the dig's own event resumes it.
            var done = machine.handleEvent("task_complete", new Object[]{ ctx.lastTaskId, true });
            assertFalse(done.isError(), "resume should succeed: " + done.getMessage());
            assertEquals(List.of("redstone", "after:true"), rec.values, "dig should resume only on task_complete");
        } finally {
            machine.close();
        }
    }
}
