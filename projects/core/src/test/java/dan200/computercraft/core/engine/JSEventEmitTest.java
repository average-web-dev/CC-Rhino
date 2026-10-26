// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.Event;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.methods.ApiMethod;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Synchronous event delivery (Phase 13): {@code events.emit} from JS and {@link JSEventEmitter#fireNow} from Java
 * running inside the machine, compared with events queued on the computer, which reach the listeners on a later
 * {@link JSMachine#handleEvent}.
 */
class JSEventEmitTest {
    private static final String PRELUDE = """
        var parallel = require('parallel');
        var events = require('events');
        var probe = require('probe');
        var wait = require('wait');
        var test = require('test');
        """;

    /** A script-defined event, fired from Java. */
    @Event("test_fired")
    public record Fired(String value) {
    }

    private final AtomicInteger ticksRequested = new AtomicInteger();
    private final JSMachineBuilder.Recorder rec = new JSMachineBuilder.Recorder();
    /** Events "queued on the computer" by {@code test.queue}: delivered only when the test fires them. */
    private final List<String> queued = new ArrayList<>();
    private @Nullable JSMachine machine;

    private final Map<String, ApiMethod> testApi = Map.of(
        "fireNow", (target, context, args) -> MethodResult.of(JSEventEmitter.current().fireNow(new Fired(args.getString(0)))),
        "queue", (target, context, args) -> {
            queued.add(args.getString(0));
            return MethodResult.of();
        }
    );

    private static final Map<String, ApiMethod> WAIT = Map.of(
        "pull", (target, context, args) -> MethodResult.pullEvent(args.getString(0),
            event -> MethodResult.of(event.length > 1 ? event[1] : null)),
        "sleep", (target, context, args) -> MethodResult.timer(args.getInt(0))
    );

    private JSMachine boot(String bios) throws IOException {
        var machine = this.machine = new JSMachineBuilder()
            .api(rec, rec.methods())
            .api("wait", WAIT)
            .api("test", testApi)
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

    private void fire(@Nullable String event, Object... args) {
        var result = machine().handleEvent(event, args);
        assertFalse(result.isError(), event + " failed: " + result.getMessage());
    }

    /** Deliver the {@code cc:js-tick}s the machine requested, as the computer would. */
    private void drainTicks() {
        var ran = 0;
        while (ticksRequested.get() > 0) {
            if (++ran > 100) throw new AssertionError("machine keeps requesting ticks");
            ticksRequested.decrementAndGet();
            fire("cc:js-tick");
        }
    }

    private JSMachine machine() {
        var machine = this.machine;
        if (machine == null) throw new IllegalStateException("not booted");
        return machine;
    }

    @Test
    void emit_calls_listeners_synchronously_and_returns_whether_there_were_any() throws Exception {
        boot("""
            events.on('greet', function (a, b) { probe.record('first ' + a + ' ' + b); });
            events.once('greet', function (a) { probe.record('once ' + a); });
            probe.record('before');
            probe.record(events.emit('greet', 'x', 2));
            probe.record('after');
            probe.record(events.emit('greet', 'y', 3));
            probe.record(events.emit('nobody'));
            """);
        assertEquals(List.of(
            "before", "first x 2", "once x", true, "after", "first y 3", true, false
        ), rec.values);
    }

    @Test
    void emit_passes_arguments_unchanged() throws Exception {
        boot("""
            var obj = { n: 1 };
            var fn = function () {};
            events.on('ref', function (o, f, u) { o.n++; probe.record((o === obj) + ' ' + (f === fn) + ' ' + u); });
            events.emit('ref', obj, fn, undefined);
            probe.record('n ' + obj.n);
            """);
        assertEquals(List.of("true true undefined", "n 2"), rec.values);
    }

    @Test
    void emit_rejects_native_events() throws Exception {
        boot("""
            events.on('key', function () { probe.record('spoofed key'); });
            events.on('task_complete', function () { probe.record('spoofed task'); });
            ['key', 'char', 'timer', 'task_complete', 'terminate', 'unhandled_rejection', '__start__'].forEach(function (name) {
                try { events.emit(name, 1, true, 'x'); probe.record('emitted ' + name); }
                catch (e) { probe.record(e.code + ': ' + e.message); }
            });
            probe.record(events.emit('my_key', 1));
            """);
        assertEquals(List.of(
            "ERR_RESERVED_EVENT: Cannot emit 'key': it is a native event, only the computer can fire it",
            "ERR_RESERVED_EVENT: Cannot emit 'char': it is a native event, only the computer can fire it",
            "ERR_RESERVED_EVENT: Cannot emit 'timer': it is a native event, only the computer can fire it",
            "ERR_RESERVED_EVENT: Cannot emit 'task_complete': it is a native event, only the computer can fire it",
            "ERR_RESERVED_EVENT: Cannot emit 'terminate': it is a native event, only the computer can fire it",
            "ERR_RESERVED_EVENT: Cannot emit 'unhandled_rejection': it is a native event, only the computer can fire it",
            "ERR_RESERVED_EVENT: Cannot emit '__start__': it is a native event, only the computer can fire it",
            false
        ), rec.values);
    }

    @Test
    void fireNow_delivers_in_the_same_call_while_a_queued_event_waits_for_the_next_tick() throws Exception {
        boot("""
            events.on('test_fired', function (v) { probe.record('listener ' + v); });
            probe.record('before');
            probe.record(test.fireNow('sync'));
            test.queue('test_fired');
            probe.record('after');
            """);
        assertEquals(List.of("before", "listener sync", true, "after"), rec.values);
        assertEquals(List.of("test_fired"), queued, "the queued event is only queued");

        // The computer delivers the queued event later, as its own handleEvent call.
        fire("test_fired", "queued");
        assertEquals(List.of("before", "listener sync", true, "after", "listener queued"), rec.values);
    }

    @Test
    void fireNow_returns_false_without_listeners_and_fails_outside_the_machine() throws Exception {
        boot("probe.record(test.fireNow('x'));");
        assertEquals(List.of(false), rec.values);
        assertThrows(IllegalStateException.class, JSEventEmitter::current, "no machine is executing on the test thread");
    }

    @Test
    void listeners_of_a_stopped_thread_are_not_called() throws Exception {
        boot("""
            var h = parallel.spawn(function () {
                events.on('custom', function () { probe.record('stopped listener'); });
                wait.pull('never');
            });
            events.on('stop', function () {
                h.stop();
                probe.record(events.emit('custom'));
            });
            """);
        drainTicks();
        fire("stop");
        assertEquals(List.of(false), rec.values);
    }

    @Test
    void listeners_run_as_the_thread_that_registered_them() throws Exception {
        // The listener belongs to the spawned thread, so a listener it registers while running belongs to that thread
        // too, and goes away when the thread is stopped — although the root thread emitted the event.
        boot("""
            var h = parallel.spawn(function () {
                events.on('register', function () {
                    events.on('inner', function () { probe.record('inner'); });
                });
                wait.pull('never');
            });
            events.on('go', function () {
                events.emit('register');
                probe.record(events.emit('inner'));
                h.stop();
                probe.record(events.emit('inner'));
            });
            """);
        drainTicks();
        fire("go");
        assertEquals(List.of("inner", true, false), rec.values);
    }

    @Test
    void an_error_in_an_own_listener_is_thrown_from_emit() throws Exception {
        boot("""
            events.on('boom', function () { throw new Error('listener failed'); });
            events.on('boom', function () { probe.record('skipped'); });
            try { events.emit('boom'); } catch (e) { probe.record('caught ' + e.message); }
            """);
        assertEquals(List.of("caught listener failed"), rec.values);
    }

    @Test
    void an_error_in_another_threads_listener_fails_that_thread() throws Exception {
        boot("""
            var h = parallel.spawn(function () {
                events.on('boom', function () { throw new Error('bg listener failed'); });
                wait.pull('never');
            });
            events.on('go', function () {
                probe.record(events.emit('boom'));
                probe.record(h.isAlive() + ' ' + h.getError().message);
            });
            events.on('boom', function () { probe.record('still called'); });
            """);
        drainTicks();
        fire("go");
        assertEquals(List.of("still called", true, "false bg listener failed"), rec.values);
    }

    private static final String BLOCKING_ERROR = "wait.pull blocks and cannot be used inside async code or callbacks "
        + "run by native code (such as Array.prototype.forEach, or a listener of another thread called by events.emit) "
        + "— use require('wait/promises') instead";

    @Test
    void an_own_listener_may_block_and_emit_returns_once_it_finished() throws Exception {
        // Like a turtle call: an I/O wait (MethodResult.pullEvent), then a timer.
        boot("""
            events.on('work', function (n) {
                probe.record('start ' + n);
                probe.record('got ' + wait.pull('x'));
                wait.sleep(3);
                probe.record('slept');
            });
            events.on('work', function () { probe.record('second listener'); });
            probe.record('emit returned ' + events.emit('work', 1));
            """);
        assertEquals(List.of("start 1"), rec.values);

        fire("x", "value");
        assertEquals(List.of("start 1", "got value"), rec.values);

        fire("timer", 3);
        assertEquals(List.of("start 1", "got value", "slept", "second listener", "emit returned true"), rec.values);
    }

    @Test
    void an_ancestors_listener_blocks_the_emitting_thread_and_receives_terminate() throws Exception {
        // The root thread's listener runs as part of the emitting child thread: it blocks that thread, and Ctrl+T
        // reaches it there (the child is in the foreground), failing emit, the child and so the waitForAll.
        boot("""
            events.on('ask', function () {
                probe.record('waiting');
                wait.pull('never');
                probe.record('not reached');
            });
            try {
                parallel.waitForAll(function () { events.emit('ask'); probe.record('not reached either'); });
            } catch (e) {
                probe.record('caught ' + e.message);
            }
            """);
        assertEquals(List.of("waiting"), rec.values);
        fire("terminate");
        assertEquals(List.of("waiting", "caught Terminated"), rec.values);
    }

    @Test
    void a_listener_of_an_unrelated_thread_cannot_block() throws Exception {
        boot("""
            parallel.spawn(function () {
                events.on('block', function () {
                    try { wait.pull('x'); probe.record('blocked'); }
                    catch (e) { probe.record(e.message); }
                    // Deferring the work to the event loop is the way out: it may block there.
                    events.setImmediate(function () { probe.record('deferred got ' + wait.pull('x')); });
                });
                wait.pull('never');
            });
            events.on('go', function () {
                events.emit('block');
                probe.record('emit returned');
            });
            """);
        drainTicks();
        fire("go");
        assertEquals(List.of(BLOCKING_ERROR, "emit returned"), rec.values);
        drainTicks();
        fire("x", "value");
        assertEquals("deferred got value", rec.values.get(rec.values.size() - 1));
    }

    @Test
    void emit_from_a_native_callback_cannot_block_its_listeners() throws Exception {
        // No continuation can be captured below Array.prototype.forEach (#38), so an own listener cannot block there.
        boot("""
            events.on('block', function () {
                try { wait.pull('x'); } catch (e) { probe.record(e.message); }
            });
            [1].forEach(function () { events.emit('block'); });
            probe.record('done');
            """);
        assertEquals(List.of(BLOCKING_ERROR, "done"), rec.values);
    }

    @Test
    void listeners_of_all_threads_run_in_registration_order() throws Exception {
        boot("""
            events.on('order', function () { probe.record('root 1'); });
            parallel.spawn(function () {
                events.on('order', function () { probe.record('other thread'); });
                wait.pull('never');
            });
            events.on('go', function () {
                events.on('order', function () { probe.record('root 2'); });
                events.emit('order');
            });
            """);
        drainTicks();
        fire("go");
        assertEquals(List.of("root 1", "other thread", "root 2"), rec.values);
    }

    @Test
    void the_promise_flavour_emits_synchronously_and_resolves_with_the_result() throws Exception {
        boot("""
            var eventsP = require('events/promises');
            events.on('p', function (v) { probe.record('listener ' + v); });
            eventsP.emit('p', 1).then(function (r) { probe.record('resolved ' + r); });
            probe.record('after emit');
            eventsP.emit('key').then(null, function (e) { probe.record('rejected ' + e.code); });
            """);
        drainTicks();
        assertEquals(List.of("listener 1", "after emit", "resolved true", "rejected ERR_RESERVED_EVENT"), rec.values);
    }

    @Test
    void emit_can_be_nested_and_used_from_native_callbacks() throws Exception {
        boot("""
            events.on('outer', function (n) { probe.record('outer ' + n); events.emit('inner', n); });
            events.on('inner', function (n) { probe.record('inner ' + n); });
            [1, 2].forEach(function (n) { events.emit('outer', n); });
            """);
        assertEquals(List.of("outer 1", "inner 1", "outer 2", "inner 2"), rec.values);
    }
}
