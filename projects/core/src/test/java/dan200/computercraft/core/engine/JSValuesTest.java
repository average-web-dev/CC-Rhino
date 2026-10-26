// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.methods.ApiMethod;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

/**
 * Conversion of values between JS and Java ({@link JSValues}): arrays round-trip as arrays (#26), and cyclic, deeply
 * nested or getter-bearing objects are rejected or handled without overflowing the Java stack (#20).
 */
class JSValuesTest {
    /** Run a bios with the {@code probe} recorder and an {@code echo} module, asserting it finishes without error. */
    private static List<Object> run(String bios) throws Exception {
        return run(bios, Map.of());
    }

    private static List<Object> run(String bios, Map<String, ApiMethod> extra) throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var echo = new HashMap<String, ApiMethod>(extra);
        echo.put("echo", (target, context, args) -> MethodResult.of(args.get(0)));

        var machine = new JSMachineBuilder()
            .api(rec, rec.methods())
            .api("echo", echo)
            .bios("var probe = require('probe'); var e = require('echo');\n" + bios)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "bios should succeed: " + result.getMessage());
            return List.copyOf(rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void arrays_round_trip_as_arrays() throws Exception {
        var values = run("""
            var r = e.echo([10, 20, [30, 'x'], []]);
            probe.record(Array.isArray(r));
            probe.record(r.length);
            probe.record(r[0] + ',' + r[1]);
            probe.record(Array.isArray(r[2]) && r[2][0] === 30 && r[2][1] === 'x');
            probe.record(Array.isArray(r[3]) && r[3].length === 0);
            """);
        assertEquals(List.of(true, 4L, "10,20", true, true), values);
    }

    @Test
    void array_holes_and_length_survive_round_trip() throws Exception {
        var values = run("""
            var a = [1, undefined, 3]; a.length = 5;
            var r = e.echo(a);
            probe.record(r.length);
            probe.record(1 in r);
            probe.record(r[2]);
            """);
        assertEquals(List.of(5L, false, 3L), values);
    }

    @Test
    void arrays_reach_java_as_one_based_tables() throws Exception {
        var values = run("probe.record([10, 20]); probe.record({ 1: 'a', x: 2 });");
        assertEquals(Map.of(1L, 10L, 2L, 20L), values.get(0));
        // Plain-object keys stay strings (as in JS) and are not shifted.
        assertEquals(Map.of("1", "a", "x", 2L), values.get(1));
    }

    @Test
    void objects_with_integer_keys_round_trip() throws Exception {
        var values = run("""
            var r = e.echo({ 0: 'zero', 1: 'one', name: 'n' });
            probe.record(Array.isArray(r));
            probe.record(r[0] + ',' + r['1'] + ',' + r.name);
            probe.record(Object.keys(r).length);
            """);
        assertEquals(List.of(false, "zero,one,n", 3L), values);
    }

    @Test
    void java_lists_and_maps_convert_to_arrays_and_objects() throws Exception {
        var values = run("""
            var l = e.list();
            probe.record(Array.isArray(l) && l[0] === 'a' && l[1] === 'b');
            var m = e.slots();
            probe.record(Array.isArray(m));
            probe.record(m[1] + ',' + m['3']);
            """, Map.of(
            "list", (target, context, args) -> MethodResult.of(List.of("a", "b")),
            // Like inventory.list(): a sparse map of 1-based slots stays an object with the same keys.
            "slots", (target, context, args) -> MethodResult.of(Map.of(1, "a", 3, "b"))
        ));
        assertEquals(List.of(true, false, "a,b"), values);
    }

    @Test
    void recursive_object_throws_js_error() throws Exception {
        var values = run("""
            var a = {}; a.self = a;
            try { probe.record(a); probe.record('no error'); } catch (err) { probe.record(String(err.message)); }
            var b = []; b.push(b);
            try { e.echo(b); probe.record('no error'); } catch (err) { probe.record(String(err.message)); }
            """);
        assertEquals(2, values.size());
        for (var value : values) {
            assertInstanceOf(String.class, value);
            assertContains((String) value, "Cannot serialise recursive object");
        }
    }

    @Test
    void shared_references_are_not_recursive() throws Exception {
        var values = run("""
            var x = { v: 1 };
            var r = e.echo({ a: x, b: x, c: [x, x] });
            probe.record(r.a.v + r.b.v + r.c[0].v + r.c[1].v);
            probe.record(r.a === r.b && r.c[0] === r.a);
            // A DAG with 2^100 paths: conversion must visit each shared node once, not once per path.
            var dag = { leaf: true };
            for (var i = 0; i < 100; i++) dag = { l: dag, r: dag };
            var d = e.echo(dag);
            probe.record(d.l === d.r);
            """);
        assertEquals(List.of(4L, true, true), values);
    }

    @Test
    void deeply_nested_object_throws_js_error() throws Exception {
        var values = run("""
            function nest(n) { var o = {}; var root = o; for (var i = 0; i < n; i++) { o.c = {}; o = o.c; } return root; }
            var ok = e.echo(nest(100));
            probe.record(typeof ok.c.c.c);
            try { e.echo(nest(100000)); probe.record('no error'); } catch (err) { probe.record(String(err.message)); }
            """);
        assertEquals("object", values.get(0));
        assertContains((String) values.get(1), "nested too deeply");
    }

    @Test
    void getters_are_not_invoked() throws Exception {
        var values = run("""
            var called = false;
            var o = { plain: 1 };
            Object.defineProperty(o, 'g', { get: function () { called = true; return 2; }, enumerable: true });
            var a = [1];
            Object.defineProperty(a, 1, { get: function () { called = true; return 2; }, enumerable: true });
            var r = e.echo({ o: o, a: a });
            probe.record(called);
            probe.record(r.o.plain + ',' + ('g' in r.o) + ',' + r.a.length + ',' + (1 in r.a));
            """);
        assertEquals(List.of(false, "1,false,2,false"), values);
    }

    @Test
    void cyclic_java_map_preserves_identity() throws Exception {
        var values = run("""
            var r = e.cyclic();
            probe.record(r.self === r && r.self.self.name === 'root');
            """, Map.of("cyclic", (target, context, args) -> {
            var map = new HashMap<String, Object>();
            map.put("name", "root");
            map.put("self", map);
            return MethodResult.of(map);
        }));
        assertEquals(List.of(true), values);
    }

    private static void assertContains(String actual, String expected) {
        if (!actual.contains(expected)) {
            throw new AssertionError("Expected \"" + actual + "\" to contain \"" + expected + "\"");
        }
    }
}
