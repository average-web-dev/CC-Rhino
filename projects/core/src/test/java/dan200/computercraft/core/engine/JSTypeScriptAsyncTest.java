// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.TaskCompletion;
import dan200.computercraft.core.methods.ApiMethod;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Issue #35 — TypeScript {@code async} functions, compiled by the ROM's tsc settings ({@code target: es2015} +
 * {@code importHelpers}), run on Rhino: {@code src/test/ts/async.ts} is transpiled by the build into
 * {@code ts-fixtures/async.js}.
 */
class JSTypeScriptAsyncTest {
    private static String fixture(String name) throws IOException {
        try (var stream = JSTypeScriptAsyncTest.class.getResourceAsStream("/ts-fixtures/" + name)) {
            return new String(Objects.requireNonNull(stream, "Missing fixture " + name).readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void async_functions_compile_to_the_tslib_awaiter() throws IOException {
        var source = fixture("async.js");
        assertTrue(source.contains("require(\"tslib\")"), "helpers are imported, not inlined:\n" + source);
        assertTrue(source.contains("__awaiter("), source);
        assertFalse(source.contains("async function") || source.contains("async ("), "no native async functions remain:\n" + source);
        assertFalse(source.contains("await wp") || source.contains("await collect"), "no native await remains:\n" + source);
    }

    private static JSMachine machine(String fixture, JSMachineBuilder.Recorder rec) throws IOException {
        return new JSMachineBuilder()
            .api("w", Map.<String, ApiMethod>of("await", (target, context, args) -> TaskCompletion.await(args.getLong(0))))
            .api(rec, rec.methods())
            // The fixture is a CommonJS module.
            .bios("(function (exports, module) {\n" + fixture(fixture) + "\n})({}, { exports: {} });")
            .build();
    }

    @Test
    void async_generators_compile_to_the_tslib_helpers() throws IOException {
        var source = fixture("async-generators.js");
        for (var helper : new String[]{ "__asyncGenerator(", "__await(", "__asyncDelegator(", "__asyncValues(" }) {
            assertTrue(source.contains("tslib_1." + helper), "uses " + helper + ":\n" + source);
        }
    }

    @Test
    void async_generators_and_for_await_run_on_rhino() throws IOException {
        var rec = new JSMachineBuilder.Recorder();
        var machine = machine("async-generators.js", rec);
        try {
            assertOk(machine.handleEvent(null, null));
            assertOk(machine.handleEvent("task_complete", new Object[]{ 1L, true, "a" }));
            assertEquals(List.of(), rec.values, "still waiting");
            assertOk(machine.handleEvent("task_complete", new Object[]{ 2L, true, "b" }));
            assertEquals(List.of("a,sync,b,p,q,r"), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void async_functions_run_on_rhino() throws IOException {
        var rec = new JSMachineBuilder.Recorder();
        var machine = machine("async.js", rec);
        try {
            assertOk(machine.handleEvent(null, null));
            for (var id = 1; id <= 3; id++) {
                assertEquals(List.of(), rec.values, "still waiting");
                assertOk(machine.handleEvent("task_complete", new Object[]{ (long) id, true, String.valueOf((char) ('a' + id - 1)) }));
            }
            assertOk(machine.handleEvent("task_complete", new Object[]{ 99L, false, "boom" }));
            assertEquals(List.of("abc caught boom!"), rec.values);
        } finally {
            machine.close();
        }
    }

    private static void assertOk(MachineResult result) {
        assertFalse(result.isError(), () -> "machine failed: " + result.getMessage());
    }
}
