// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.methods.ApiMethod;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Tests the native {@code parallel} module (green threads, {@link EventLoop}) and {@code terminate} handling.
 *
 * <p>The machine is driven by hand: every {@code cc:js-tick} it asks for is delivered by {@link #drainTicks}, so the
 * tests can check that waiting does not keep the event loop busy. Blocking is provided by a {@code wait} module:
 * {@code pull(name)} waits for an event (returning its first argument), {@code sleep(id)} for a {@code timer} event
 * with that id and {@code yield()} for the next tick.
 */
class JSParallelTest {
    private static final String PRELUDE = """
        var parallel = require('parallel');
        var events = require('events');
        var probe = require('probe');
        var wait = require('wait');
        """;

    private final AtomicInteger ticksRequested = new AtomicInteger();
    private final JSMachineBuilder.Recorder rec = new JSMachineBuilder.Recorder();
    private @Nullable JSMachine machine;

    private static final Map<String, ApiMethod> WAIT = Map.of(
        "pull", (target, context, args) -> MethodResult.pullEvent(args.getString(0),
            event -> MethodResult.of(event.length > 1 ? event[1] : null)),
        "sleep", (target, context, args) -> MethodResult.timer(args.getInt(0)),
        "yield", (target, context, args) -> MethodResult.yield()
    );

    private JSMachine boot(String bios) throws IOException {
        var machine = this.machine = new JSMachineBuilder()
            .api(rec, rec.methods())
            .api("wait", WAIT)
            .scheduleTick(ticksRequested::incrementAndGet)
            .bios(PRELUDE + bios)
            .build();
        fire(null);
        return machine;
    }

    @AfterEach
    void close() {
        if (machine != null) machine.close();
    }

    /** Deliver the {@code cc:js-tick}s the machine requested, as the computer would. Returns how many ran. */
    private int drainTicks() {
        var ran = 0;
        while (ticksRequested.get() > 0) {
            if (++ran > 100) throw new AssertionError("machine keeps requesting ticks");
            ticksRequested.decrementAndGet();
            var result = machine().handleEvent("cc:js-tick", null);
            assertFalse(result.isError(), "tick failed: " + result.getMessage());
        }
        return ran;
    }

    private void fire(@Nullable String event, Object... args) {
        var result = machine().handleEvent(event, args);
        assertFalse(result.isError(), event + " failed: " + result.getMessage());
    }

    /** Deliver a single requested {@code cc:js-tick}. */
    private void tick() {
        assertEquals(true, ticksRequested.getAndDecrement() > 0, "no tick was requested");
        fire("cc:js-tick");
    }

    private JSMachine machine() {
        var machine = this.machine;
        if (machine == null) throw new IllegalStateException("not booted");
        return machine;
    }

    @Test
    void waitForAll_returns_once_every_thread_returned_without_polling() throws Exception {
        boot("""
            var r = parallel.waitForAll(
                function () { probe.record('a ' + wait.pull('a')); },
                function () { wait.sleep(7); probe.record('b slept'); }
            );
            probe.record('done ' + r);
            """);
        assertEquals(0, ticksRequested.get(), "threads blocked in I/O and timers must not request ticks");
        assertEquals(List.of(), rec.values);

        fire("a", "x");
        assertEquals(List.of("a x"), rec.values);
        assertEquals(0, ticksRequested.get());

        fire("timer", 7);
        assertEquals(List.of("a x", "b slept", "done undefined"), rec.values);
        assertEquals(0, ticksRequested.get());
    }

    @Test
    void synchronous_tasks_complete_immediately() throws Exception {
        boot("""
            var order = [];
            parallel.waitForAll(function () { order.push(1); }, function () { order.push(2); });
            probe.record(order.join(','));
            probe.record('' + parallel.waitForAny(function () {}, function () {}));
            probe.record('' + parallel.waitForN(5, function () {}, function () {}));
            probe.record('' + parallel.waitForAny());
            probe.record('' + parallel.waitForN(0, function () { probe.record('never'); }));
            for (var i = 0; i < 3000; i++) parallel.waitForAll(function () {});
            probe.record('looped');
            """);
        assertEquals(List.of("1,2", "0", "2", "-1", "0", "looped"), rec.values);
    }

    @Test
    void waitForAny_stops_the_other_threads() throws Exception {
        boot("""
            var winner = parallel.waitForAny(
                function () { wait.pull('never'); probe.record('loser 0 resumed'); },
                function () { wait.pull('go'); },
                function () {
                    events.on('ping', function () { probe.record('loser listener'); });
                    wait.sleep(3);
                    probe.record('loser 2 resumed');
                }
            );
            probe.record('winner ' + winner);
            """);
        fire("go");
        assertEquals(List.of("winner 1"), rec.values);

        // The losers' blocked calls and listeners were discarded.
        fire("never");
        fire("timer", 3);
        fire("ping");
        assertEquals(List.of("winner 1"), rec.values);
        assertEquals(0, ticksRequested.get());
    }

    @Test
    void waitForN_returns_once_enough_threads_returned() throws Exception {
        boot("""
            var n = parallel.waitForN(2,
                function () { wait.pull('a'); },
                function () { wait.pull('b'); },
                function () { wait.pull('c'); probe.record('c resumed'); }
            );
            probe.record('done ' + n);
            """);
        fire("a");
        assertEquals(List.of(), rec.values, "one returned thread is not enough");
        fire("b");
        assertEquals(List.of("done 2"), rec.values);
        fire("c");
        assertEquals(List.of("done 2"), rec.values);
    }

    @Test
    void stopped_thread_blocked_in_yield_is_not_resumed() throws Exception {
        boot("""
            parallel.waitForAny(
                function () { while (true) { wait.yield(); probe.record('spin'); } },
                function () { wait.pull('go'); }
            );
            probe.record('done');
            """);
        assertEquals(1, ticksRequested.get(), "a yield asks for exactly one tick");
        tick();
        assertEquals(List.of("spin"), rec.values);
        fire("go");
        drainTicks();
        assertEquals(List.of("spin", "done"), rec.values);
        assertEquals(0, ticksRequested.get(), "the stopped spinner must not keep the loop busy");
    }

    @Test
    void failing_thread_stops_siblings_and_rethrows_at_call_site() throws Exception {
        boot("""
            try {
                parallel.waitForAll(
                    function () { wait.pull('go'); null.boom; },
                    function () { wait.sleep(1); probe.record('sibling resumed'); }
                );
                probe.record('returned');
            } catch (e) {
                probe.record((e instanceof TypeError) + ' ' + e.name);
            }
            try {
                parallel.waitForAny(function () { var err = new Error('custom'); err.code = 42; throw err; });
            } catch (e) {
                probe.record(e.message + ' ' + e.code);
            }
            """);
        fire("go");
        fire("timer", 1);
        assertEquals(List.of("true TypeError", "custom 42"), rec.values);
    }

    @Test
    void error_in_a_thread_listener_fails_the_thread_not_the_machine() throws Exception {
        boot("""
            try {
                parallel.waitForAll(function () {
                    events.on('ping', function () { throw new Error('from listener'); });
                    wait.pull('never');
                });
            } catch (e) {
                probe.record('caught ' + e.message);
            }
            """);
        fire("ping");
        assertEquals(List.of("caught from listener"), rec.values);
        fire("ping"); // the listener died with its thread
        assertEquals(List.of("caught from listener"), rec.values);
    }

    @Test
    void nested_groups_are_stopped_together() throws Exception {
        boot("""
            var r = parallel.waitForAny(
                function () {
                    parallel.waitForAll(
                        function () { wait.sleep(1); probe.record('inner a'); },
                        function () { parallel.spawn(function () { wait.sleep(2); probe.record('grandchild'); }); wait.pull('never'); }
                    );
                    probe.record('inner done');
                },
                function () { wait.pull('go'); probe.record('outer b'); }
            );
            probe.record('winner ' + r);
            """);
        fire("go");
        assertEquals(List.of("outer b", "winner 1"), rec.values);
        fire("timer", 1);
        fire("timer", 2);
        fire("never");
        assertEquals(List.of("outer b", "winner 1"), rec.values);
    }

    @Test
    void nested_group_result_reaches_outer_thread() throws Exception {
        boot("""
            parallel.waitForAll(function () {
                var i = parallel.waitForAny(function () { wait.pull('x'); }, function () { wait.pull('y'); });
                probe.record('inner ' + i);
            });
            probe.record('outer');
            """);
        fire("y");
        assertEquals(List.of("inner 1", "outer"), rec.values);
    }

    @Test
    void spawn_runs_in_background_and_stop_cancels_it() throws Exception {
        boot("""
            var h = parallel.spawn(function () {
                events.on('ping', function () { probe.record('ping'); });
                wait.sleep(5);
                probe.record('woke');
            });
            probe.record('spawned ' + h.isAlive());
            events.on('kill', function () { h.stop(); probe.record('alive ' + h.isAlive()); });
            var f = parallel.spawn(function () { throw new Error('bg'); });
            events.on('check', function () { probe.record('failed ' + f.isAlive() + ' ' + f.getError().message); });
            """);
        fire("ping");
        fire("kill");
        fire("timer", 5);
        fire("ping");
        fire("check");
        assertEquals(List.of("spawned true", "ping", "alive false", "failed false bg"), rec.values);
    }

    @Test
    void returned_thread_leaves_listeners_to_its_parent() throws Exception {
        boot("""
            parallel.waitForAll(function () { events.on('ping', function () { probe.record('ping'); }); });
            probe.record('done');
            """);
        fire("ping");
        assertEquals(List.of("done", "ping"), rec.values);
    }

    @Test
    void terminate_throws_in_the_foreground_and_is_catchable() throws Exception {
        boot("""
            var bg = parallel.spawn(function () { wait.sleep(9); probe.record('background survived'); });
            events.on('run', function () {
                try {
                    parallel.waitForAll(
                        function () {
                            try { wait.sleep(1); } catch (e) { probe.record('a ' + e.message); }
                            wait.pull('again');
                            probe.record('a continued');
                        },
                        function () { while (true) wait.yield(); }
                    );
                } catch (e) {
                    probe.record('shell ' + e.message);
                }
            });
            """);
        fire("run");
        tick();
        fire("terminate");
        drainTicks();
        // a caught it and is blocked again; the spinning b did not, so the group failed and a was stopped.
        assertEquals(List.of("a Terminated", "shell Terminated"), rec.values);
        assertEquals(0, ticksRequested.get());

        fire("again");
        fire("terminate"); // nothing in the foreground any more
        fire("timer", 9);
        assertEquals(List.of("a Terminated", "shell Terminated", "background survived"), rec.values);
    }

    @Test
    void terminate_leaves_root_alone() throws Exception {
        boot("""
            wait.sleep(1);
            probe.record('root woke');
            """);
        fire("terminate");
        fire("timer", 1);
        assertEquals(List.of("root woke"), rec.values);
    }

    @Test
    void terminated_program_loses_its_listeners() throws Exception {
        // Mirrors bash: a root listener runs the program as a foreground thread.
        boot("""
            events.on('key', function () {
                try {
                    parallel.waitForAll(function () {
                        events.on('char', function (c) { probe.record('char ' + c); });
                        while (true) wait.yield();
                    });
                } catch (e) {
                    probe.record(e.message);
                }
                probe.record('prompt');
            });
            """);
        fire("key");
        fire("char", "a");
        fire("terminate");
        fire("char", "b");
        drainTicks();
        assertEquals(List.of("char a", "Terminated", "prompt"), rec.values);
        assertEquals(0, ticksRequested.get());
    }
}
