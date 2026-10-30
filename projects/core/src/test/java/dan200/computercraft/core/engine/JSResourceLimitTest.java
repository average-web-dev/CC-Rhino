// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Issue #19 — a script must not be able to exhaust the server heap or the interpreter stack. Runaway recursion and
 * oversized strings fail as script errors (catchable where possible), and any {@link StackOverflowError} /
 * {@link OutOfMemoryError} that still escapes the script becomes a {@link MachineResult} error.
 */
class JSResourceLimitTest {
    /** Run {@code bios} with a {@code probe} module, returning the boot result and the recorded values. */
    private static Run run(String bios) {
        return assertTimeoutPreemptively(Duration.ofSeconds(30), () -> {
            var rec = new JSMachineBuilder.Recorder();
            var machine = new JSMachineBuilder().api(rec, rec.methods()).bios(bios).build();
            try {
                return new Run(machine.handleEvent(null, null), List.copyOf(rec.values));
            } finally {
                machine.close();
            }
        });
    }

    private record Run(MachineResult result, List<Object> values) {
    }

    @Test
    void deep_recursion_is_a_catchable_error() {
        var run = run("""
            var probe = require('probe');
            function f() { f(); }
            try { f(); probe.record("no error"); } catch (e) { probe.record(String(e)); }
            """);
        assertFalse(run.result().isError(), () -> "recursion error should be catchable: " + run.result().getMessage());
        assertEquals(1, run.values().size());
        assertTrue(run.values().getFirst().toString().contains("Exceeded maximum stack depth"), run.values().toString());
    }

    @Test
    void uncaught_deep_recursion_is_a_machine_error() {
        var run = run("function f() { f(); } f();");
        assertTrue(run.result().isError());
        assertTrue(String.valueOf(run.result().getMessage()).contains("Exceeded maximum stack depth"), run.result().getMessage());
    }

    @Test
    void native_recursion_stack_overflow_is_a_machine_error() {
        // Each forEach re-enters the interpreter on a fresh Java frame, so this overflows the Java stack instead.
        var run = run("function f() { [0].forEach(f); } f();");
        assertTrue(run.result().isError(), "native recursion should fail as a machine error");
    }

    /** The string, buffer and argument limits are set on the context, see {@code CCContextFactory.makeContext}. */
    private static final String CHECK = """
        var probe = require('probe');
        function check(fn) {
            try { fn(); probe.record("no error"); }
            catch (e) { probe.record((e instanceof RangeError) + ":" + e.message); }
        }
        """;

    private static final String STRING_TOO_LONG = "true:Invalid string length";

    @Test
    void doubling_concatenation_is_a_catchable_range_error() {
        var run = run(CHECK + "check(function () { var s = 'x'; for (var i = 0; i < 40; i++) s = s + s; });");
        assertFalse(run.result().isError(), () -> String.valueOf(run.result().getMessage()));
        assertEquals(List.of(STRING_TOO_LONG), run.values());
    }

    @Test
    void oversized_strings_are_catchable_range_errors() {
        var run = run(CHECK + """
            var s = 'x'.repeat(1 << 24);
            check(function () { return 'x'.repeat(1e9); });
            check(function () { return 'x'.padStart(1e9); });
            check(function () { return 'x'.padEnd(1e9, 'ab'); });
            check(function () { return s + s + s; });
            check(function () { return [s, s, s].join(''); });
            check(function () { var a = []; a.length = 1e8; return a.join('xyz'); });
            check(function () { return JSON.stringify([s, s, s]); });
            check(function () { return s.replace(/^/, "$'$'"); });
            """);
        assertFalse(run.result().isError(), () -> String.valueOf(run.result().getMessage()));
        assertEquals(Collections.nCopies(8, STRING_TOO_LONG), run.values());
    }

    @Test
    void oversized_buffers_and_argument_lists_are_catchable_range_errors() {
        var run = run(CHECK + """
            check(function () { return new ArrayBuffer(2 ** 31 - 2); });
            check(function () { return new Float64Array(2 ** 27); });
            check(function () { return Math.max.apply(null, { length: 2 ** 31 - 1 }); });
            check(function () { return Reflect.apply(Math.max, null, { length: 1e9 }); });
            """);
        assertFalse(run.result().isError(), () -> String.valueOf(run.result().getMessage()));
        assertEquals(4, run.values().size(), run.values()::toString);
        for (var value : run.values()) assertTrue(value.toString().startsWith("true:"), run.values()::toString);
    }

    @Test
    void repeat_and_pad_keep_standard_behaviour() {
        var run = run("""
            var probe = require('probe');
            probe.record('ab'.repeat(3));
            probe.record('ab'.repeat(0));
            probe.record('5'.padStart(3, '0'));
            probe.record('abc'.padEnd(6, '12'));
            probe.record('abc'.padStart(8, 'xy'));
            probe.record('x'.padEnd(3));
            probe.record('x'.padStart(1e9, ''));
            probe.record('long'.padStart(2));
            try { 'x'.repeat(-1); } catch (e) { probe.record(e instanceof RangeError); }
            try { String.prototype.repeat.call(undefined, 1); } catch (e) { probe.record(e instanceof TypeError); }
            probe.record(Object.keys(String.prototype).indexOf('repeat'));
            """);
        assertFalse(run.result().isError(), () -> String.valueOf(run.result().getMessage()));
        assertEquals(List.of("ababab", "", "005", "abc121", "xyxyxabc", "x  ", "x", "long", true, true, -1),
            run.values().stream().map(v -> v instanceof Number n ? n.intValue() : v).toList());
    }
}
