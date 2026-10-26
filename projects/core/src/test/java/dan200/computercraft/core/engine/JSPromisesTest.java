// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.*;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Issue #35 — the async model: Rhino promise jobs run on the event loop, every native module has a
 * {@code <module>/promises} flavour, {@code async.run}/{@code async.unwrap} bridge both styles, and blocking calls
 * inside async code fail with a clear error before they have any effect.
 */
class JSPromisesTest {
    /** Runs main-thread tasks immediately and hands back incrementing task ids (see {@code JSBlockingAPITest}). */
    private static final class ImmediateContext implements IContext {
        long lastTaskId = 0;

        @Override
        public long issueMainThreadTask(ScriptTask task) throws ScriptException {
            task.execute();
            return ++lastTaskId;
        }
    }

    /** A handle returned by {@link WaitAPI#open()}. */
    public static final class Handle {
        @ScriptFunction
        public final MethodResult await(long id) {
            return TaskCompletion.await(id);
        }
    }

    /** The {@code w} module: methods with known blocking behaviour, generated from {@code @ScriptFunction}s. */
    public static final class WaitAPI implements IComputerAPI {
        int calls = 0;

        @Override
        public String[] getNames() {
            return new String[]{ "w" };
        }

        /** Blocks until {@code task_complete} for {@code id}. */
        @ScriptFunction
        public final MethodResult await(long id) {
            calls++;
            return TaskCompletion.await(id);
        }

        /** Runs on the main thread, i.e. blocks until its own task completes. */
        @ScriptFunction(mainThread = true)
        public final String main() {
            calls++;
            return "main";
        }

        /** Never blocks. */
        @ScriptFunction
        public final int value() {
            return 42;
        }

        @ScriptFunction
        public final void fail() throws ScriptException {
            throw new ScriptException("ENOENT: no such file", Map.of("code", "ENOENT"));
        }

        /** Fails once the {@code go} event arrives. */
        @ScriptFunction
        public final MethodResult failLater() {
            return MethodResult.pullEvent("go", event -> {
                throw new ScriptException("EIO: later", Map.of("code", "EIO"));
            });
        }

        @ScriptFunction
        public final String readSync(String path) {
            return "read " + path;
        }

        @ScriptFunction
        public final void read(String path, Object callback) {
        }

        @ScriptFunction
        public final Handle open() {
            return new Handle();
        }
    }

    private final ImmediateContext context = new ImmediateContext();
    private final WaitAPI api = new WaitAPI();
    private final JSMachineBuilder.Recorder rec = new JSMachineBuilder.Recorder();
    private @Nullable JSMachine machine;

    private JSMachine boot(String bios) throws IOException {
        var machine = this.machine = new JSMachineBuilder()
            .context(context)
            .api(api)
            .api(rec, rec.methods())
            .bios("""
                var w = require('w');
                var wp = require('w/promises');
                var async = require('async');
                var events = require('events');
                var parallel = require('parallel');
                var probe = require('probe');
                function record(v) { probe.record(v); }
                """ + bios)
            .build();
        assertOk(machine.handleEvent(null, null));
        return machine;
    }

    @AfterEach
    void close() {
        if (machine != null) machine.close();
    }

    private static void assertOk(MachineResult result) {
        assertFalse(result.isError(), () -> "machine failed: " + result.getMessage());
    }

    private MachineResult complete(long id, boolean ok, Object value) {
        assertNotNull(machine);
        return machine.handleEvent("task_complete", new Object[]{ id, ok, value });
    }

    // ------------------------------------------------------------------ promise jobs

    @Test
    void promise_jobs_run_after_the_current_code() throws Exception {
        boot("""
            Promise.resolve(1).then(function (v) { record('then ' + v); return v + 1; })
                .then(function (v) { record('then ' + v); });
            record('sync');
            """);
        assertEquals(List.of("sync", "then 1", "then 2"), rec.values);
    }

    @Test
    void promise_jobs_and_queue_microtask_share_one_fifo_queue() throws Exception {
        boot("""
            events.queueMicrotask(function () { record('task 1'); });
            Promise.resolve().then(function () { record('job 1'); });
            events.queueMicrotask(function () { record('task 2'); });
            Promise.resolve().then(function () { record('job 2'); });
            """);
        assertEquals(List.of("task 1", "job 1", "task 2", "job 2"), rec.values);
    }

    @Test
    void rejections_reach_catch() throws Exception {
        boot("""
            Promise.reject(new Error('nope'))['catch'](function (e) { record(e.message); });
            new Promise(function () { throw new TypeError('bad'); })['catch'](function (e) { record(e.name); });
            """);
        assertEquals(List.of("nope", "TypeError"), rec.values);
    }

    // ------------------------------------------------------------------ /promises modules

    @Test
    void promises_module_settles_when_the_operation_completes() throws Exception {
        boot("""
            var p = wp.await(7);
            record(p instanceof Promise);
            p.then(function (v) { record('done ' + v); });
            record('after');
            """);
        assertEquals(List.of(true, "after"), rec.values, "the caller keeps running");
        assertOk(complete(7, true, "v"));
        assertEquals(List.of(true, "after", "done v"), rec.values);
    }

    @Test
    void non_blocking_methods_return_settled_promises() throws Exception {
        boot("""
            wp.value().then(function (v) { record(v); });
            wp.fail().then(null, function (e) { record(e instanceof Error); record(e.message); record(e.code); });
            """);
        assertEquals(List.of(42L, true, "ENOENT: no such file", "ENOENT"), rec.values);
    }

    @Test
    void failures_reject_with_the_error_the_blocking_form_throws() throws Exception {
        boot("""
            wp.await(7).then(null, function (e) { record('task ' + e.message); });
            wp.failLater().then(null, function (e) { record('later ' + e.message + ' ' + e.code); });
            events.on('go', function () {
                try { w.failLater(); } catch (e) { record('blocking ' + e.message + ' ' + e.code); }
            });
            """);
        assertOk(complete(7, false, "boom"));
        assertNotNull(machine);
        assertOk(machine.handleEvent("go", new Object[0]));
        assertOk(machine.handleEvent("go", new Object[0]));
        assertEquals(List.of("task boom", "later EIO: later EIO", "blocking EIO: later EIO"), rec.values);
    }

    @Test
    void main_thread_methods_return_promises() throws Exception {
        boot("wp.main().then(record);");
        assertEquals(List.of(), rec.values);
        assertOk(complete(context.lastTaskId, true, "main"));
        assertEquals(List.of("main"), rec.values);
    }

    @Test
    void sync_and_callback_pairs_collapse_like_node() throws Exception {
        boot("""
            record(typeof wp.readSync);
            wp.read('/a').then(record);
            """);
        assertEquals(List.of("undefined", "read /a"), rec.values);
    }

    @Test
    void objects_from_promise_calls_have_promise_methods() throws Exception {
        boot("""
            record(typeof w.open().await);
            wp.open().then(function (h) {
                var p = h.await(3);
                record(p instanceof Promise);
                p.then(record);
            });
            """);
        assertOk(complete(3, true, "handle"));
        assertEquals(List.of("function", true, "handle"), rec.values);
    }

    @Test
    void promise_all_runs_operations_concurrently() throws Exception {
        boot("""
            Promise.all([wp.await(1), wp.await(2)]).then(function (vs) { record(vs.join(',')); });
            record('started');
            """);
        assertEquals(2, api.calls, "both operations started before either completed");
        assertOk(complete(2, true, "b"));
        assertEquals(List.of("started"), rec.values);
        assertOk(complete(1, true, "a"));
        assertEquals(List.of("started", "a,b"), rec.values);
    }

    @Test
    void parallel_promises_settle_with_the_group() throws Exception {
        boot("""
            var pp = require('parallel/promises');
            pp.waitForAll(function () { record('t1 ' + w.await(1)); }, function () { record('t2 ' + w.await(2)); })
                .then(function () { record('all'); });
            pp.waitForAny(function () { throw new Error('bad'); })['catch'](function (e) { record(e.message); });
            record('caller');
            """);
        assertEquals(List.of("caller", "bad"), rec.values);
        assertOk(complete(1, true, "a"));
        assertOk(complete(2, true, "b"));
        assertEquals(List.of("caller", "bad", "t1 a", "t2 b", "all"), rec.values);
    }

    // ------------------------------------------------------------------ async.run / async.unwrap

    @Test
    void run_awaits_yielded_promises() throws Exception {
        boot("""
            async.run(function* (x) {
                var a = yield wp.await(1);
                var b = yield 'plain';
                try { yield wp.await(2); } catch (e) { record('caught ' + e.message); }
                return x + a + b;
            }, 'x').then(record);
            """);
        assertOk(complete(1, true, "a"));
        assertOk(complete(2, false, "boom"));
        assertEquals(List.of("caught boom", "xaplain"), rec.values);
    }

    @Test
    void unwrap_blocks_until_the_promise_settles() throws Exception {
        boot("""
            record(async.unwrap(5));
            record(async.unwrap(wp.await(1)));
            try { async.unwrap(wp.await(2)); } catch (e) { record('threw ' + e.message); }
            record(async.unwrap(async.run(function* () { return (yield wp.await(3)) + '!'; })));
            """);
        assertEquals(List.of(5L), rec.values);
        assertOk(complete(1, true, "a"));
        assertOk(complete(2, false, "boom"));
        assertOk(complete(3, true, "c"));
        assertEquals(List.of(5L, "a", "threw boom", "c!"), rec.values);
    }

    @Test
    void tslib_provides_the_awaiter() throws Exception {
        boot("""
            var tslib = require('tslib');
            tslib.__awaiter(undefined, void 0, void 0, function* () { return (yield Promise.resolve(1)) + 1; }).then(record);
            record(JSON.stringify(tslib.__rest({ a: 1, b: 2 }, ['a'])));
            """);
        assertEquals(List.of("{\"b\":2}", 2L), rec.values);
    }

    // ------------------------------------------------------------------ blocking inside async code

    @Test
    void blocking_inside_a_generator_throws_before_running() throws Exception {
        boot("""
            async.run(function* () { w.await(1); })['catch'](function (e) { record(e.message); });
            async.run(function* () { w.main(); })['catch'](function (e) { record(e.message); });
            """);
        assertEquals(List.of(
            "w.await blocks and cannot be used inside async code — use require('w/promises') instead",
            "w.main blocks and cannot be used inside async code — use require('w/promises') instead"
        ), rec.values);
        assertEquals(0, api.calls, "the methods never ran");
    }

    @Test
    void blocking_inside_promise_callbacks_throws() throws Exception {
        boot("""
            Promise.resolve().then(function () { w.await(1); })['catch'](function (e) { record(e.message); });
            Promise.resolve().then(function () { async.unwrap(wp.value()); })['catch'](function (e) { record(e.message); });
            Promise.resolve().then(function () { parallel.waitForAll(function () {}); })['catch'](function (e) { record(e.message); });
            Promise.resolve().then(function () { record(w.value()); });
            """);
        // The catch reactions are queued behind the fourth callback.
        assertEquals(List.of(
            42L,
            "w.await blocks and cannot be used inside async code — use require('w/promises') instead",
            "async.unwrap blocks and cannot be used inside async code — use yield (inside async.run) or await instead",
            "parallel.waitForAll blocks and cannot be used inside async code — use require('parallel/promises') instead"
        ), rec.values);
        assertEquals(0, api.calls);
    }

    @Test
    void blocking_inside_native_callbacks_throws_a_clear_error() throws Exception {
        boot("""
            try { [1].forEach(function () { w.await(1); }); } catch (e) { record(e.message); }
            """);
        assertEquals(List.of(
            "w.await blocks and cannot be used inside async code or callbacks run by native code (such as "
                + "Array.prototype.forEach) — use require('w/promises') instead"
        ), rec.values);
    }

    @Test
    void blocking_calls_outside_async_code_are_unchanged() throws Exception {
        boot("""
            function* gen() { yield w.value(); }
            for (var v of gen()) record(v);
            record(w.await(1));
            """);
        assertOk(complete(1, true, "a"));
        assertEquals(List.of(42L, "a"), rec.values);
    }

    // ------------------------------------------------------------------ threads

    @Test
    void reactions_of_a_stopped_thread_never_run() throws Exception {
        boot("""
            var shared;
            var handle = parallel.spawn(function () {
                shared = wp.await(1);
                shared.then(function () { record('stopped thread'); });
                Promise.resolve().then(function () { record('never'); });
                handle.stop();
            });
            parallel.waitForAll(function () { system_sleep(); });
            function system_sleep() { w.await(9); }
            """);
        assertOk(complete(9, true, null));
        assertEquals(List.of(), rec.values);
    }

    @Test
    void pending_operation_of_a_stopped_thread_rejects_for_other_threads() throws Exception {
        boot("""
            var shared;
            var handle = parallel.spawn(function () {
                shared = wp.await(1);
                shared.then(function () { record('stopped thread'); }, function () { record('stopped thread'); });
                w.await(2);
            });
            parallel.waitForAll(function () {}); // let the thread start
            shared.then(null, function (e) { record('other ' + e.message); });
            handle.stop();
            try { async.unwrap(shared); } catch (e) { record('unwrap ' + e.message); }
            """);
        assertEquals(List.of("other Terminated", "unwrap Terminated"), rec.values);
        // The discarded operation does not settle the promise again.
        assertOk(complete(1, true, "late"));
        assertEquals(List.of("other Terminated", "unwrap Terminated"), rec.values);
    }

    @Test
    void reactions_run_as_the_thread_that_registered_them() throws Exception {
        boot("""
            var p = wp.await(1);
            var handle = parallel.spawn(function () {
                p.then(function () {
                    events.setImmediate(function () { record('owned by spawned thread'); });
                    handle.stop();
                });
                w.await(2);
            });
            """);
        assertOk(complete(1, true, null));
        assertEquals(List.of(), rec.values, "work the reaction started belongs to its (now stopped) thread");
    }

    @Test
    void terminate_reaches_a_foreground_unwrap() throws Exception {
        boot("""
            try {
                parallel.waitForAny(function () { async.unwrap(wp.await(1)); });
            } catch (e) {
                record(e.message);
            }
            """);
        assertNotNull(machine);
        assertOk(machine.handleEvent("terminate", new Object[0]));
        assertEquals(List.of("Terminated"), rec.values);
    }
}
