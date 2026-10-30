// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Issue #47 — the ES2015+ feature matrix of Rhino (1.9.x with the backports of average-web-dev/rhino), and the transforms of {@code babel-preset-rhino}
 * ({@code src/build/babel-preset-rhino}) that make the broken features work.
 *
 * <p>{@link #nativeSupport()} runs plain JS snippets on the machine, without any compiler, and pins what Rhino supports
 * natively and what it lacks or gets wrong. If a Rhino upgrade fixes a feature, its row fails: mark it as native and
 * drop the corresponding plugin from the preset.
 *
 * <p>{@link #compiled(String)} runs the TypeScript fixtures under {@code src/test/ts/features/}, compiled by the real
 * pipeline (type-checked by tsc, compiled by Babel with the preset; see {@code compile-ts.mjs}), which use every
 * feature, including the broken ones. Each fixture reports its checks through the global
 * {@code check(label, actual, expected)}.
 */
class JSRhinoFeatureTest {
    /** Rhino supports the feature as is. */
    private static final boolean NATIVE = true;
    /** Rhino rejects the syntax or computes something else: babel-preset-rhino transforms it. */
    private static final boolean BROKEN = false;

    private record Feature(String name, boolean nativeSupport, String expected, String body) {
    }

    private static final List<Feature> FEATURES = List.of(
        // Natively supported.
        new Feature("arrow functions", NATIVE, "4,5", """
            function f() { var g = (a) => a * 2 + arguments[0]; return g(1); }
            var h = (a, b) => a + b;
            return [h(2, 2), f(3)].join();
            """),
        new Feature("template literals", NATIVE, "a1b|x2", """
            var x = 1;
            function tag(s, v) { return s.raw[0] + v; }
            return `a${x}b` + "|" + tag`x${x + 1}`;
            """),
        new Feature("let/const outside loops", NATIVE, "6", """
            const a = 1; let b = 2;
            if (true) { const c = 3; b += c; }
            return a + b;
            """),
        new Feature("let in a loop body, captured by closures", NATIVE, "0,1,2", """
            var fs = [];
            for (var i = 0; i < 3; i++) { let j = i; fs.push(function () { return j; }); }
            return fs.map(function (f) { return f(); }).join();
            """),
        new Feature("default parameters", NATIVE, "3,5", """
            function f(a, b = 2) { return a + b; }
            return [f(1), f(1, 4)].join();
            """),
        new Feature("destructuring of arrays and objects", NATIVE, "10,3", """
            var [a, b] = [1, 2];
            var { c, d: e } = { c: 3, d: 4 };
            function f({ x }, [y]) { return x + y; }
            return [a + b + c + e, f({ x: 1 }, [2])].join();
            """),
        new Feature("object spread", NATIVE, "1,2", """
            var o = { ...{ a: 1 }, b: 2 };
            return [o.a, o.b].join();
            """),
        new Feature("array spread", NATIVE, "0,1,2,3,a,b", """
            return [0, ...[1, 2], ...new Set([3]), ..."ab"].join();
            """),
        new Feature("optional chaining", NATIVE, "undefined,1,undefined", """
            var o = null, p = { a: { b: 1 } };
            return [String(o?.x), p.a?.b, String(o?.f())].join();
            """),
        new Feature("nullish coalescing", NATIVE, "3,0", """
            return [null ?? 3, 0 ?? 4].join();
            """),
        new Feature("exponent operator", NATIVE, "1024,9", """
            var x = 3; x **= 2;
            return [2 ** 10, x].join();
            """),
        new Feature("logical assignment", NATIVE, "4,5,6", """
            var a = null, b = 1, c = 0;
            a ??= 4; b &&= 5; c ||= 6;
            return [a, b, c].join();
            """),
        new Feature("numeric separators", NATIVE, "1000000", """
            return 1_000_000;
            """),
        new Feature("computed properties, shorthand properties and methods", NATIVE, "1,2,3,4", """
            var k = "x", y = 2;
            var o = { [k]: 1, y, m() { return 3; }, get g() { return 4; } };
            return [o.x, o.y, o.m(), o.g].join();
            """),
        new Feature("super in object literals", NATIVE, "2", """
            var p = { m() { return 1; } };
            var o = { __proto__: p, m() { return super.m() + 1; } };
            return o.m();
            """),
        new Feature("for-of over iterables", NATIVE, "6,a1b2,01", """
            var s = 0, m = "", it = "";
            for (var v of new Set([1, 2, 3])) s += v;
            for (var e of new Map([["a", 1], ["b", 2]])) m += e[0] + e[1];
            var custom = { [Symbol.iterator]: function () {
                var i = 0;
                return { next: function () { return i < 2 ? { value: i++, done: false } : { value: undefined, done: true }; } };
            } };
            for (var c of custom) it += c;
            return [s, m, it].join();
            """),
        new Feature("Symbol", NATIVE, "symbol,true", """
            var a = Symbol("x");
            return [typeof a, typeof Symbol.iterator === "symbol"].join();
            """),
        new Feature("generators", NATIVE, "1,2,3,done", """
            function* inner() { yield 2; }
            function* g() { yield 1; yield* inner(); try { yield 3; } finally { log.push("done"); } }
            var log = [];
            for (var v of g()) log.push(v);
            return log.join();
            """),
        new Feature("optional catch binding", NATIVE, "ok", """
            try { throw new Error(); } catch { return "ok"; }
            """),
        new Feature("local named like an Object.prototype member (#41)", NATIVE, "5,6", """
            function f(o) { let constructor = 5; return function () { return constructor; }; }
            function g() { for (var i = 0; i < 1; i++) { let toString = 6; return toString; } }
            return [f()(), g()].join();
            """),
        new Feature("generator functions inherit from Function.prototype", NATIVE, "true,function,1,2", """
            function* g(a) { yield a; }
            var GeneratorFunction = Object.getPrototypeOf(g);
            return [Object.getPrototypeOf(GeneratorFunction) === Function.prototype, typeof g.apply,
                g.call(null, 1).next().value, GeneratorFunction.constructor("yield 2")().next().value].join();
            """),
        new Feature("array destructuring with a rest element", NATIVE, "2", """
            var [a, ...rest] = [1, 2, 3];
            return rest.length;
            """),
        new Feature("object rest", NATIVE, "2", """
            var { a, ...rest } = { a: 1, b: 2 };
            return rest.b;
            """),
        new Feature("stack of an Error whose prototype changed (class E extends Error)", NATIVE, "string", """
            function E() {}
            E.prototype = Object.create(Error.prototype);
            var e = new Error("m");
            Object.setPrototypeOf(e, E.prototype);
            return typeof e.stack;
            """),
        new Feature("Reflect.get with a receiver (super.getter)", NATIVE, "1", """
            var p = { get x() { return this.v; } };
            return Reflect.get(p, "x", { v: 1 });
            """),
        new Feature("rest parameters, called through apply (#41)", NATIVE, "[1,2,3]", """
            function f(...rest) { return JSON.stringify(rest); }
            return f.apply(null, [1, 2, 3]);
            """),

        // Broken: transformed by babel-preset-rhino.
        new Feature("class", BROKEN, "2", """
            class A { constructor(x) { this.x = x; } get y() { return this.x; } }
            return new A(2).y;
            """),
        new Feature("class fields", BROKEN, "1", """
            class A { x = 1; }
            return new A().x;
            """),
        new Feature("#private class members", BROKEN, "1", """
            class A { #x = 1; get() { return this.#x; } }
            return new A().get();
            """),
        new Feature("class static blocks", BROKEN, "1", """
            class A { static { A.y = 1; } }
            return A.y;
            """),
        new Feature("const in a loop body", BROKEN, "0,1,2", """
            var r = [];
            for (var i = 0; i < 3; i++) { const c = i; r.push(c); }
            return r.join();
            """),
        new Feature("const in a for-of head", BROKEN, "1,2", """
            var r = [];
            for (const c of [1, 2]) r.push(c);
            return r.join();
            """),
        new Feature("let in a for head, captured by closures", BROKEN, "0,1,2", """
            var fs = [];
            for (let i = 0; i < 3; i++) fs.push(function () { return i; });
            return fs.map(function (f) { return f(); }).join();
            """),
        new Feature("let in a for-of head, captured by closures", BROKEN, "0,1,2", """
            var fs = [];
            for (let i of [0, 1, 2]) fs.push(function () { return i; });
            return fs.map(function (f) { return f(); }).join();
            """),
        new Feature("spread in calls", BROKEN, "3", """
            function f(a, b) { return a + b; }
            return f(...[1, 2]);
            """),
        new Feature("spread in new", BROKEN, "3", """
            function F(a, b) { this.s = a + b; }
            return new F(...[1, 2]).s;
            """),
        new Feature("array destructuring of iterables", BROKEN, "3", """
            var [a, b] = new Set([1, 2]);
            return a + b;
            """),
        new Feature("new.target", BROKEN, "true", """
            function F() { this.ok = new.target === F; }
            return new F().ok;
            """),
        new Feature("unparenthesized yield in arguments", BROKEN, "1", """
            function* g() { return String(yield 1); }
            return g().next().value;
            """),
        new Feature("yield operand followed by a comma", BROKEN, "0", """
            function* g() { var x = 0, r; r = yield x, x = 5; return x; }
            return g().next().value;
            """),

        // Broken: babel-preset-rhino's for-of plugin (for-of.mjs) closes the iterator (#41).
        new Feature("break out of a for-of closes the iterator", BROKEN, "fin", """
            var log = "";
            function* g() { try { yield 1; yield 2; } finally { log = "fin"; } }
            for (var v of g()) break;
            return log;
            """),
        new Feature("return out of a for-of closes the iterator", BROKEN, "fin", """
            var log = "";
            function* g() { try { yield 1; yield 2; } finally { log = "fin"; } }
            (function () { for (var v of g()) return v; })();
            return log;
            """),
        new Feature("throw out of a for-of closes the iterator", BROKEN, "fin", """
            var log = "";
            function* g() { try { yield 1; yield 2; } finally { log = "fin"; } }
            try { for (var v of g()) throw new Error(); } catch (e) {}
            return log;
            """),
        new Feature("labelled break out of nested for-of closes both iterators", BROKEN, "i,o", """
            var log = [];
            function* g(n) { try { yield 1; yield 2; } finally { log.push(n); } }
            outer: for (var a of g("o")) for (var b of g("i")) break outer;
            return log.join();
            """),
        new Feature("break out of a for-of closes a plain iterator object", BROKEN, "1", """
            var closes = 0, i = 0;
            var it = { next: function () { return { value: i++, done: false }; },
                       "return": function () { closes++; return {}; } };
            it[Symbol.iterator] = function () { return this; };
            for (var v of it) if (v === 1) break;
            return closes;
            """),

        // Broken: lowered by babel-preset-rhino to native generators driven by the babel-helpers module.
        new Feature("async functions", BROKEN, "function", """
            async function f() { return 1; }
            return typeof f;
            """),
        new Feature("async generators", BROKEN, "function", """
            async function* f() { yield 1; }
            return typeof f;
            """)
    );

    /** Run {@code body} as a function body on a fresh machine, returning its result as a string. */
    private static String runNative(String body) {
        var rec = new JSMachineBuilder.Recorder();
        var bios = "var probe = require('probe');\n"
            + "try { probe.record(String((function () {\n" + body + "\n})())); }\n"
            + "catch (e) { probe.record('threw ' + e); }\n";
        JSMachine machine;
        try {
            machine = new JSMachineBuilder().api(rec, rec.methods()).bios(bios).build();
        } catch (Exception e) {
            return "rejected: " + e.getMessage();
        }
        try {
            var result = machine.handleEvent(null, null);
            if (result.isError()) return "machine error: " + result.getMessage();
            return rec.values.isEmpty() ? "nothing recorded" : Objects.toString(rec.values.get(0));
        } finally {
            machine.close();
        }
    }

    @TestFactory
    Stream<DynamicTest> nativeSupport() {
        return FEATURES.stream().map(feature -> DynamicTest.dynamicTest(
            (feature.nativeSupport() ? "native: " : "broken: ") + feature.name(), () -> {
                var actual = runNative(feature.body());
                if (feature.nativeSupport()) {
                    assertEquals(feature.expected(), actual, feature.name());
                } else {
                    assertNotEquals(feature.expected(), actual,
                        "Rhino now supports '" + feature.name() + "': mark it NATIVE and drop its transform");
                }
            }));
    }

    private static String fixture(String name) throws IOException {
        try (var stream = JSRhinoFeatureTest.class.getResourceAsStream("/ts-fixtures/features/" + name + ".js")) {
            return new String(Objects.requireNonNull(stream, "Missing fixture " + name).readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** The global {@code check(label, actual, expected)} of the fixtures (see src/test/ts/features/check.d.ts). */
    private static final String CHECK_JS = """
        var check = (function (probe) {
            function show(value) {
                if (typeof value === "string") return JSON.stringify(value);
                if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
                return String(value);
            }
            return function check(label, actual, expected) {
                var a = show(actual), e = show(expected);
                probe.record(a === e ? "ok " + label : "FAIL " + label + ": got " + a + ", expected " + e);
            };
        })(require("probe"));
        """;

    /** Checks that fixtures make in promise callbacks, which must have run by the end of the first event. */
    private static final Map<String, String> ASYNC_CHECKS = Map.of(
        "iterator-closing", "for await closes the iterator"
    );

    @ParameterizedTest
    @ValueSource(strings = {
        "classes", "block-scoping", "spread", "parameters", "destructuring", "new-target", "operators",
        "literals", "iteration", "generators", "iterator-closing",
    })
    void compiled(String name) throws IOException {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api(rec, rec.methods())
            .bios(CHECK_JS + "(function (exports, module) {\n" + fixture(name) + "\n})({}, { exports: {} });")
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), () -> "machine failed: " + result.getMessage() + "\n" + rec.values);
        } finally {
            machine.close();
        }

        var asyncCheck = ASYNC_CHECKS.get(name);
        if (asyncCheck != null) {
            assertTrue(rec.values.stream().anyMatch(v -> Objects.toString(v).matches("(ok|FAIL) " + Pattern.quote(asyncCheck) + "(:.*)?")),
                () -> "the asynchronous check '" + asyncCheck + "' did not run: " + rec.values);
        }

        var failures = new ArrayList<String>();
        for (var value : rec.values) {
            if (!Objects.toString(value).startsWith("ok ")) failures.add(Objects.toString(value));
        }
        assertEquals(List.of(), failures, "failed checks");
        assertTrue(rec.values.size() >= 3, () -> "too few checks ran: " + rec.values);
    }

    private static final Pattern CLASS_SYNTAX = Pattern.compile("\\bclass\\s+\\w+\\s*(extends\\b|\\{)");

    @Test
    void helpers_are_imported_not_inlined() throws IOException {
        var source = fixture("classes");
        assertTrue(source.contains("require(\"babel-helpers\")"), source);
        assertFalse(source.contains("function _classCallCheck"), "helpers are not inlined:\n" + source);
        assertFalse(CLASS_SYNTAX.matcher(source).find(), "no class syntax remains:\n" + source);
    }
}
