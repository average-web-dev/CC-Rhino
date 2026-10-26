// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.apis.SystemAPI;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.test.core.apis.BasicApiEnvironment;
import dan200.computercraft.test.core.computer.BasicEnvironment;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Issue #13 — timing of the event loop phases, using the real {@code system.sleep} / {@code system.yield}.
 *
 * <p>The test plays the computer: it owns the event queue and the timers. Timers count down once per game tick
 * ({@link #gameTick()}), exactly like {@code Environment#tick}, and queue a {@code timer} event when they expire. The
 * {@code cc:js-tick}s the machine requests go to the same queue. {@link #cycle()} delivers a single event (one pass of
 * the event loop); {@link #gameTick()} advances the clock and then delivers everything that is queued.
 */
class JSEventLoopTimingTest {
    private static final String PRELUDE = """
        var system = require('system');
        var events = require('events');
        var parallel = require('parallel');
        var probe = require('probe');
        var clock = require('clock');
        function at(label) { probe.record(label + '@' + clock.now()); }
        """;

    private final JSMachineBuilder.Recorder rec = new JSMachineBuilder.Recorder();
    private final ArrayDeque<Object[]> queue = new ArrayDeque<>();
    private final Map<Integer, long[]> timers = new LinkedHashMap<>();
    private int nextTimer = 0;
    private int now = 0;
    private @Nullable JSMachine machine;

    private final SystemAPI system = new SystemAPI(new BasicApiEnvironment(new BasicEnvironment()) {
        @Override
        public int startTimer(long ticks) {
            timers.put(nextTimer, new long[]{ ticks });
            return nextTimer++;
        }

        @Override
        public void cancelTimer(int id) {
            timers.remove(id);
        }

        @Override
        public void queueEvent(String event, @Nullable Object... args) {
            queue.add(event(event, args));
        }
    });

    private void boot(String bios) throws Exception {
        machine = new JSMachineBuilder()
            .api(system)
            .api(rec, rec.methods())
            .api("clock", Map.<String, ApiMethod>of("now", (target, context, args) -> MethodResult.of(now)))
            .api("wait", Map.<String, ApiMethod>of("pull", (target, context, args) ->
                MethodResult.pullEvent(args.getString(0), event -> MethodResult.of())))
            .scheduleTick(() -> queue.add(event("cc:js-tick")))
            .bios(PRELUDE + bios)
            .build();
        deliver(null);
    }

    @AfterEach
    void close() {
        if (machine != null) machine.close();
    }

    private static Object[] event(String name, @Nullable Object... args) {
        var event = new Object[1 + (args == null ? 0 : args.length)];
        event[0] = name;
        if (args != null) System.arraycopy(args, 0, event, 1, args.length);
        return event;
    }

    private void deliver(@Nullable String name, Object... args) {
        var machine = Objects.requireNonNull(this.machine);
        var result = machine.handleEvent(name, args);
        assertFalse(result.isError(), () -> name + " failed: " + result.getMessage());
    }

    /** Deliver the next queued event: one pass of the event loop. */
    private void cycle() {
        var event = queue.poll();
        assertNotNull(event, "no event queued");
        deliver((String) event[0], Arrays.copyOfRange(event, 1, event.length));
    }

    /** Advance the clock by one game tick, fire expired timers and deliver every queued event. */
    private void gameTick() {
        now++;
        for (var it = timers.entrySet().iterator(); it.hasNext(); ) {
            var timer = it.next();
            if (--timer.getValue()[0] <= 0) {
                queue.add(event("timer", timer.getKey()));
                it.remove();
            }
        }
        for (var i = 0; !queue.isEmpty(); i++) {
            if (i > 1000) fail("the event loop never goes idle");
            cycle();
        }
    }

    private void gameTicks(int count) {
        for (var i = 0; i < count; i++) gameTick();
    }

    @Test
    void sleep_resumes_after_exactly_the_requested_ticks() throws Exception {
        boot("system.sleep(1); at('one'); system.sleep(5); at('five'); system.sleep(0); at('zero');");
        assertEquals(List.of(), rec.values, "sleep must block");

        gameTick();
        assertEquals(List.of("one@1"), rec.values);

        gameTicks(4);
        assertEquals(List.of("one@1"), rec.values, "woke up early");
        gameTick();
        assertEquals(List.of("one@1", "five@6"), rec.values);

        // sleep(0) is clamped to a single tick.
        gameTick();
        assertEquals(List.of("one@1", "five@6", "zero@7"), rec.values);
        assertTrue(queue.isEmpty() && timers.isEmpty(), "a finished program leaves nothing behind");
    }

    @Test
    void concurrent_sleeps_each_fire_at_their_own_tick() throws Exception {
        boot("""
            parallel.waitForAll(
                function () { system.sleep(3); at('a'); },
                function () { system.sleep(1); at('b'); system.sleep(1); at('b2'); },
                function () { system.sleep(2); at('c'); }
            );
            parallel.spawn(function () { system.sleep(2); at('spawned'); });
            at('joined');
            """);
        // The bios is blocked in waitForAll, so the spawned thread is only created after all three sleepers are done.
        gameTicks(3);
        assertEquals(List.of("b@1", "c@2", "b2@2", "a@3", "joined@3"), rec.values);

        gameTicks(2);
        assertEquals(List.of("b@1", "c@2", "b2@2", "a@3", "joined@3", "spawned@5"), rec.values);
    }

    @Test
    void phases_run_in_order_within_one_cycle() throws Exception {
        boot("""
            var wait = require('wait');
            parallel.spawn(function () {
                wait.pull('go');
                probe.record('io');
                events.queueMicrotask(function () { probe.record('microtask from io'); });
            });
            events.on('go', function () {
                probe.record('listener');
                events.setImmediate(function () { probe.record('immediate'); });
                events.queueMicrotask(function () { probe.record('microtask from listener'); });
                system.yield();
                probe.record('yield');
            });
            """);
        // Starting the spawned thread is all the boot work there is; no further ticks are needed.
        assertTrue(queue.isEmpty(), "an idle machine must not request ticks");

        deliver("go");
        assertEquals(List.of(
            "io", "microtask from io",                 // Phase 2 (I/O), then its microtasks
            "listener", "microtask from listener",     // listeners, then their microtasks
            "yield",                                   // Phase 4: yields parked before the phase started
            "immediate"                                // Phase 5: setImmediate callbacks
        ), rec.values);
    }

    @Test
    void microtasks_run_before_the_next_io_phase() throws Exception {
        boot("""
            var wait = require('wait');
            parallel.spawn(function () {
                while (true) {
                    wait.pull('io');
                    probe.record('io');
                    events.queueMicrotask(function () {
                        probe.record('micro 1');
                        events.queueMicrotask(function () { probe.record('micro 2'); });
                    });
                }
            });
            """);
        deliver("io");
        assertEquals(List.of("io", "micro 1", "micro 2"), rec.values);
        deliver("io");
        assertEquals(List.of("io", "micro 1", "micro 2", "io", "micro 1", "micro 2"), rec.values);
    }

    @Test
    void set_immediate_added_during_the_check_phase_runs_next_cycle() throws Exception {
        boot("""
            events.setImmediate(function () {
                probe.record('first');
                events.queueMicrotask(function () { probe.record('microtask'); });
                events.setImmediate(function () { probe.record('second'); });
            });
            """);
        assertEquals(List.of(), rec.values, "setImmediate must not run during boot");

        cycle();
        assertEquals(List.of("first", "microtask"), rec.values, "the new callback must wait for the next cycle");

        cycle();
        assertEquals(List.of("first", "microtask", "second"), rec.values);
        assertTrue(queue.isEmpty(), "nothing left to do, so no further tick is requested");
    }

    @Test
    void clear_immediate_cancels_a_callback_of_the_running_check_phase() throws Exception {
        boot("""
            var later;
            events.setImmediate(function () { probe.record('first'); events.clearImmediate(later); });
            later = events.setImmediate(function () { probe.record('cancelled'); });
            events.setImmediate(function () { probe.record('third'); });
            """);
        cycle();
        assertEquals(List.of("first", "third"), rec.values);
    }

    @Test
    void yield_resumes_once_per_cycle() throws Exception {
        boot("""
            function loop(name) {
                return function () { for (var i = 1; i <= 3; i++) { system.yield(); probe.record(name + i); } };
            }
            parallel.spawn(loop('a'));
            parallel.spawn(loop('b'));
            """);
        assertEquals(List.of(), rec.values);

        cycle();
        assertEquals(List.of("a1", "b1"), rec.values);
        cycle();
        assertEquals(List.of("a1", "b1", "a2", "b2"), rec.values);
        cycle();
        assertEquals(List.of("a1", "b1", "a2", "b2", "a3", "b3"), rec.values);
        assertTrue(queue.isEmpty(), "both loops finished, so no further tick is requested");
    }
}
