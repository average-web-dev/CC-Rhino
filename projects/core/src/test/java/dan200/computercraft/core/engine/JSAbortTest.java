// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.computer.TimeoutState;
import dan200.computercraft.core.methods.ApiMethod;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Issue #30 — a hard abort is reported as {@link MachineResult#TIMEOUT} wherever the runaway code runs (bios,
 * listeners, resumed sleeps / I/O waits / yields, microtasks, {@code setImmediate} callbacks and green threads), and
 * scripts cannot swallow it with {@code try}/{@code catch}.
 *
 * <p>Scripts trigger the abort themselves through the {@code abort} module ({@code hard()} / {@code soft()}) right
 * before spinning, so the tests do not depend on wall-clock timing.
 */
class JSAbortTest {
    private static final String PRELUDE = """
        var events = require('events');
        var parallel = require('parallel');
        var abort = require('abort');
        var wait = require('wait');
        function spin() { while (true) {} }
        """;

    private static final Map<String, ApiMethod> WAIT = Map.of(
        "pull", (target, context, args) -> MethodResult.pullEvent(args.getString(0), event -> MethodResult.of()),
        "sleep", (target, context, args) -> MethodResult.timer(args.getInt(0)),
        "yield", (target, context, args) -> MethodResult.yield()
    );

    /** A timeout whose abort flags are set by the script itself. */
    private static final class ScriptedTimeout extends TimeoutState {
        @Override
        public void refresh() {
        }

        synchronized void hard() {
            hardAbort = true;
            updateListeners();
        }

        synchronized void soft() {
            softAbort = true;
            updateListeners();
        }
    }

    private final ScriptedTimeout timeout = new ScriptedTimeout();
    private @Nullable JSMachine machine;

    private JSMachine boot(String bios) throws IOException {
        var machine = this.machine = new JSMachineBuilder()
            .api("abort", Map.of(
                "hard", (target, context, args) -> {
                    timeout.hard();
                    return MethodResult.of();
                },
                "soft", (target, context, args) -> {
                    timeout.soft();
                    return MethodResult.of();
                }
            ))
            .api("wait", WAIT)
            .timeout(timeout)
            .bios(PRELUDE + bios)
            .build();
        return machine;
    }

    @AfterEach
    void close() {
        if (machine != null) machine.close();
    }

    private static MachineResult handle(JSMachine machine, @Nullable String event, Object... args) {
        return assertTimeoutPreemptively(Duration.ofSeconds(10), () -> machine.handleEvent(event, args));
    }

    /** Boot {@code bios} (which must not abort), then deliver {@code event} and expect a {@link MachineResult#TIMEOUT}. */
    private void assertTimeoutOn(String bios, String event, Object... args) throws IOException {
        var machine = boot(bios);
        var boot = handle(machine, null);
        assertFalse(boot.isError(), () -> "boot failed: " + boot.getMessage());
        assertSame(MachineResult.TIMEOUT, handle(machine, event, args));
    }

    @Test
    void in_the_bios() throws IOException {
        assertSame(MachineResult.TIMEOUT, handle(boot("abort.hard(); spin();"), null));
    }

    @Test
    void in_a_microtask() throws IOException {
        assertSame(MachineResult.TIMEOUT, handle(boot("events.queueMicrotask(function () { abort.hard(); spin(); });"), null));
    }

    @Test
    void in_a_listener() throws IOException {
        assertTimeoutOn("events.on('go', function () { abort.hard(); spin(); });", "go");
    }

    @Test
    void in_a_set_immediate_callback() throws IOException {
        assertTimeoutOn("events.setImmediate(function () { abort.hard(); spin(); });", "cc:js-tick");
    }

    @Test
    void in_a_resumed_yield() throws IOException {
        assertTimeoutOn("wait.yield(); abort.hard(); spin();", "cc:js-tick");
    }

    @Test
    void in_a_resumed_sleep() throws IOException {
        assertTimeoutOn("wait.sleep(3); abort.hard(); spin();", "timer", 3);
    }

    @Test
    void in_a_resumed_io_wait() throws IOException {
        assertTimeoutOn("wait.pull('go'); abort.hard(); spin();", "go");
    }

    @Test
    void in_a_spawned_thread() throws IOException {
        assertSame(MachineResult.TIMEOUT, handle(boot("parallel.spawn(function () { abort.hard(); spin(); });"), null));
    }

    @Test
    void in_a_wait_for_all_thread() throws IOException {
        assertTimeoutOn("""
            parallel.waitForAll(function () { wait.pull('go'); abort.hard(); spin(); }, function () { wait.pull('never'); });
            """, "go");
    }

    @Test
    void cannot_be_caught() throws IOException {
        // Each abort is caught and the loop starts again: the script would never finish if JS could catch it.
        var machine = boot("""
            abort.hard();
            while (true) { try { spin(); } catch (e) {} finally { continue; } }
            """);
        assertSame(MachineResult.TIMEOUT, handle(machine, null));
    }

    @Test
    void cannot_be_caught_in_a_thread() throws IOException {
        var machine = boot("""
            parallel.waitForAll(function () {
                abort.hard();
                while (true) { try { spin(); } catch (e) {} }
            });
            """);
        assertSame(MachineResult.TIMEOUT, handle(machine, null));
    }

    @Test
    void soft_abort_is_catchable_and_reported_with_the_abort_message() throws IOException {
        var machine = boot("""
            var caught = false;
            abort.soft();
            try { spin(); } catch (e) { caught = true; }
            if (caught) spin();
            """);
        var result = handle(machine, null);
        assertTrue(result.isError());
        assertEquals(TimeoutState.ABORT_MESSAGE, result.getMessage());
    }
}
