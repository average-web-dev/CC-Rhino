// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.core.methods.ApiMethod;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Sandbox hardening: the global object only holds an explicit set of names (no LiveConnect), and exceptions from
 * native methods reach scripts as plain JS {@code Error}s without Java class names.
 */
class JSSandboxTest {
    /**
     * Every own property of the global object. A new entry here (e.g. after a Rhino upgrade) must be reviewed:
     * anything that reaches Java must not be exposed.
     */
    private static final List<String> ALLOWED_GLOBALS = List.of(
        // ECMAScript value properties and functions
        "NaN", "Infinity", "undefined", "globalThis",
        "eval", "isFinite", "isNaN", "parseFloat", "parseInt",
        "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "unescape",
        // ECMAScript constructors and namespaces
        "Object", "Function", "Array", "String", "Boolean", "Number", "BigInt", "Symbol", "Date", "RegExp", "Math",
        "JSON", "Reflect", "Proxy", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Iterator",
        "ArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
        "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
        "Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError",
        "AggregateError",
        // Rhino extensions (pure JS, no Java access). JavaException is only an Error subtype constructor.
        "global", "uneval", "isXMLName", "InternalError", "JavaException", "StopIteration", "Continuation",
        "Script", "Call", "CallSite", "With",
        // Installed by the CC runtime
        "require"
    );

    private static final String INTERNAL = JSMethodBridge.INTERNAL_ERROR_MESSAGE;

    @Test
    void globals_match_the_allow_list() throws Exception {
        var probe = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api(probe, probe.methods())
            .bios("require('probe').record(Object.getOwnPropertyNames(globalThis).join(','));")
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "boot should succeed: " + result.getMessage());

            var actual = new TreeSet<>(Arrays.asList(((String) probe.values.get(0)).split(",")));
            assertEquals(new TreeSet<>(ALLOWED_GLOBALS), actual, "globals differ from the allow-list");

            // LiveConnect entry points must never be present, whatever the allow-list says.
            for (var name : List.of("Packages", "java", "javax", "JavaImporter", "JavaAdapter", "getClass",
                "importClass", "importPackage")) {
                assertFalse(actual.contains(name), name + " must not be a global");
            }
        } finally {
            machine.close();
        }
    }

    private static Map<String, ApiMethod> failingApi() {
        return Map.of(
            "fail", (target, context, args) -> {
                throw new ScriptException("expected failure");
            },
            "crash", (target, context, args) -> {
                throw new IllegalStateException("java.lang.secret detail");
            }
        );
    }

    private static String describe(String call) {
        return """
            try { %s; probe.record('no error'); } catch (e) {
                probe.record([e instanceof Error, e.name, e.message, e.javaException === undefined,
                    e.rhinoException === undefined, String(e)].join('|'));
            }
            """.formatted(call);
    }

    @Test
    void native_exceptions_become_plain_errors() throws Exception {
        var probe = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("native", failingApi())
            .api(probe, probe.methods())
            .bios("var n = require('native'); var probe = require('probe');\n"
                + describe("n.fail()") + describe("n.crash()"))
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "boot should succeed: " + result.getMessage());
            assertEquals(List.of(
                "true|Error|expected failure|true|true|Error: expected failure",
                "true|Error|" + INTERNAL + "|true|true|Error: " + INTERNAL
            ), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void uncaught_native_exceptions_do_not_leak_java_names() throws Exception {
        for (var call : List.of("fail", "crash")) {
            var machine = new JSMachineBuilder()
                .api("native", failingApi())
                .bios("require('native')." + call + "();")
                .build();
            try {
                var result = machine.handleEvent(null, null);
                assertTrue(result.isError(), call + " should stop the machine");
                var message = result.getMessage();
                assertNotNull(message);
                assertFalse(message.contains("Exception") || message.contains("java") || message.contains("dan200"),
                    "message leaks Java details: " + message);
                assertTrue(message.contains(call.equals("fail") ? "expected failure" : INTERNAL), message);
            } finally {
                machine.close();
            }
        }
    }

    @Test
    void java_reflection_is_unreachable() throws Exception {
        var probe = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api(probe, probe.methods())
            .bios("""
                var probe = require('probe');
                probe.record([typeof Packages, typeof java, typeof getClass, typeof JavaAdapter,
                    typeof JavaImporter].join(','));
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "boot should succeed: " + result.getMessage());
            assertEquals(List.of("undefined,undefined,undefined,undefined,undefined"), probe.values);
        } finally {
            machine.close();
        }
    }
}
