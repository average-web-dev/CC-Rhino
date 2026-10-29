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
 * The engine side of the JS timers (#45) and of the keep-alive used for shell jobs (#46): the {@code internal/loop}
 * module ({@link JSLoopModule}, {@link JSTimers}, {@link EventLoop#isIdle}).
 *
 * <p>Like {@link JSEventLoopTimingTest}, the test plays the computer: it owns the timers and the event queue.
 * {@link #gameTick()} advances the clock, queues the events of expired timers — in <em>reverse</em> id order, as CC
 * gives no ordering guarantee for timers expiring in the same tick — and delivers everything.
 */
class JSTimersTest {
    private static final String PRELUDE = """
        var loop = require('internal/loop');
        var system = require('system');
        var events = require('events');
        var parallel = require('parallel');
        var probe = require('probe');
        var clock = require('clock');
        function at(label) { probe.record(label + '@' + clock.now()); }
        """;

    private final JSMachineBuilder.Recorder rec = new JSMachineBuilder.Recorder();
    private final ArrayDeque<Object[]> queue = new ArrayDeque<>();
    /** id → due tick. */
    private final Map<Integer, Long> timers = new HashMap<>();
    private int nextTimer = 0;
    private long now = 0;
    private @Nullable JSMachine machine;

    private final MachineTimers clock = new MachineTimers() {
        @Override
        public Started start(long ticks) {
            var id = nextTimer++;
            timers.put(id, now + ticks);
            return new Started(id, now + ticks);
        }

        @Override
        public void cancel(int id) {
            timers.remove(id);
        }
    };

    private final SystemAPI system = new SystemAPI(new BasicApiEnvironment(new BasicEnvironment()) {
        @Override
        public int startTimer(long ticks) {
            return clock.start(ticks).id();
        }

        @Override
        public void cancelTimer(int id) {
            clock.cancel(id);
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
            .timers(clock)
            .scheduleTick(() -> queue.add(event("cc:js-tick")))
            .bios(PRELUDE + bios)
            .build();
        deliver(null);
        drain();
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

    private void drain() {
        for (var i = 0; !queue.isEmpty(); i++) {
            if (i > 100_000) fail("the event loop never goes idle");
            var event = queue.poll();
            deliver((String) event[0], Arrays.copyOfRange(event, 1, event.length));
        }
    }

    /** Advance the clock by one game tick, fire expired timers (in reverse id order) and deliver every queued event. */
    private void gameTick() {
        now++;
        var expired = new ArrayList<Integer>();
        for (var timer : timers.entrySet()) if (timer.getValue() <= now) expired.add(timer.getKey());
        expired.sort(Comparator.reverseOrder());
        for (var id : expired) {
            timers.remove(id);
            queue.add(event("timer", id));
        }
        drain();
    }

    private void gameTicks(int count) {
        for (var i = 0; i < count; i++) gameTick();
    }

    @Test
    void timers_fire_in_due_time_then_creation_order() throws Exception {
        boot("""
            loop.schedule(function () { at('c3'); }, 3, false, true);
            loop.schedule(function () { at('a1'); }, 1, false, true);
            loop.schedule(function () { at('b3'); }, 3, false, true);
            loop.schedule(function () { at('d1'); }, 1, false, true);
            loop.schedule(function () { at('min'); }, 0, false, true);
            """);
        assertEquals(List.of(), rec.values, "timers never run synchronously");
        gameTick();
        assertEquals(List.of("a1@1", "d1@1", "min@1"), rec.values);
        gameTicks(2);
        assertEquals(List.of("a1@1", "d1@1", "min@1", "c3@3", "b3@3"), rec.values);
        assertTrue(timers.isEmpty(), "no CC timers left behind");
    }

    @Test
    void cancel_and_intervals() throws Exception {
        boot("""
            var n = 0, later;
            var interval = loop.schedule(function () {
                at('tick' + (++n));
                if (n === 3) loop.cancel(interval);
            }, 2, true, true);
            // Cancelled by a timer that runs before it, in the same tick.
            loop.schedule(function () { at('first'); loop.cancel(later); }, 1, false, true);
            later = loop.schedule(function () { at('cancelled'); }, 1, false, true);
            var gone = loop.schedule(function () { at('gone'); }, 1, false, true);
            probe.record('cancel ' + loop.cancel(gone) + ' ' + loop.cancel(gone));
            """);
        gameTicks(10);
        assertEquals(List.of("cancel true false", "first@1", "tick1@2", "tick2@4", "tick3@6"), rec.values);
        assertTrue(timers.isEmpty(), "no CC timers left behind");
    }

    @Test
    void refresh_restarts_the_countdown() throws Exception {
        boot("""
            var t = loop.schedule(function () { at('fired'); }, 3, false, true);
            loop.schedule(function () { probe.record('refresh ' + loop.refresh(t)); }, 2, false, true);
            """);
        gameTicks(10);
        assertEquals(List.of("refresh true", "fired@5"), rec.values);
    }

    @Test
    void callbacks_run_in_their_thread_and_may_block() throws Exception {
        boot("""
            loop.schedule(function () { at('start'); system.sleep(2); at('end'); }, 1, false, true);
            loop.schedule(function () { at('other'); }, 2, false, true);
            var child = parallel.spawn(function () {
                loop.schedule(function () { at('never'); }, 3, false, true);
                system.sleep(10);
            });
            loop.schedule(function () { child.stop(); }, 2, false, true);
            """);
        gameTicks(6);
        // The stopped child's timer never fires (its CC timer was cancelled; only its sleep's is left).
        assertEquals(List.of("start@1", "other@2", "end@3"), rec.values);
        assertEquals(1, timers.size(), "the stopped thread's timer is cancelled");
    }

    @Test
    void terminate_discards_the_foreground_programs_timers() throws Exception {
        boot("""
            try {
                parallel.waitForAll(function () {
                    loop.schedule(function () { at('never'); }, 5, true, true);
                    system.sleep(100);
                });
            } catch (e) {
                at(e.message);
            }
            """);
        gameTick();
        deliver("terminate");
        drain();
        gameTicks(10);
        assertEquals(List.of("Terminated@1"), rec.values);
    }

    @Test
    void many_timers() throws Exception {
        boot("""
            var fired = 0;
            for (var i = 0; i < 20000; i++) loop.schedule(function () { fired++; }, 1 + (i % 50), false, true);
            loop.schedule(function () { probe.record(fired); }, 51, false, true);
            """);
        var start = System.nanoTime();
        gameTicks(51);
        assertEquals(1, rec.values.size());
        assertEquals(20000, ((Number) rec.values.get(0)).intValue());
        var millis = (System.nanoTime() - start) / 1_000_000;
        assertTrue(millis < 20_000, "20000 timers took " + millis + "ms");
    }

    @Test
    void wait_idle_waits_for_ref_d_work() throws Exception {
        boot("""
            parallel.waitForAll(function () {
                loop.schedule(function () { at('timer'); }, 3, false, true);
                var unref = loop.schedule(function () { at('unref'); }, 1, false, false);
                require('system/promises').sleep(5).then(function () { at('promise'); });
                parallel.spawn(function () { system.sleep(7); at('child'); });
                events.on('never', function () {});
                var h = loop.handle();
                loop.schedule(function () { at('release'); loop.handleClose(h); }, 9, false, false);
                var idle = loop.waitIdle();
                at('idle ' + idle);
            });
            """);
        gameTicks(12);
        assertEquals(List.of("unref@1", "timer@3", "promise@5", "child@7", "release@9", "idle true@9"), rec.values);
    }

    @Test
    void wake_idle_returns_false() throws Exception {
        boot("""
            parallel.waitForAll(function () {
                loop.handle();
                loop.schedule(function () { loop.wakeIdle(); }, 2, false, false);
                at('woken ' + loop.waitIdle());
            });
            """);
        gameTicks(4);
        assertEquals(List.of("woken false@2"), rec.values);
    }

    @Test
    void an_idle_thread_returns_at_once() throws Exception {
        boot("""
            parallel.waitForAll(function () {
                events.on('key', function () {});
                var p = new Promise(function () {});
                at('idle ' + loop.waitIdle());
            });
            """);
        assertEquals(List.of("idle true@0"), rec.values);
    }
}
