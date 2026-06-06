// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.MemoryMount;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Phase 8.5 — {@code require()} loads file-based modules from the CC {@link FileSystem}, executes them, returns their
 * {@code module.exports}, and caches the result.
 */
class JSRequireTest {
    private static FileSystem fsWith(MemoryMount mount) throws Exception {
        return new FileSystem("hdd", mount);
    }

    @Test
    void absolute_module_is_executed_and_exports_returned() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("greeting.js", "module.exports = { value: 42, hello: function () { return 'hi'; } };");
        var rec = new JSMachineBuilder.Recorder();

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(rec, rec.methods())
            .bios("""
                var g = require('/greeting');
                var probe = require('probe');
                probe.record(g.value);
                probe.record(g.hello());
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "require of a filesystem module should succeed: " + result.getMessage());
            // 42 is a JS number; JSValues.toJava normalises integral doubles to Long.
            assertEquals(List.of(42L, "hi"), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void module_exports_are_cached() throws Exception {
        var mount = new MemoryMount();
        // Each execution pushes a new value; if the module is re-executed the two requires would differ.
        mount.addFile("counter.js", "module.exports = { n: Math.random() };");

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .bios("""
                var a = require('/counter');
                var b = require('/counter');
                if (a !== b) throw new Error('expected cached module identity');
                if (a.n !== b.n) throw new Error('expected cached value');
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "repeated require should return the cached exports: " + result.getMessage());
        } finally {
            machine.close();
        }
    }

    @Test
    void missing_module_throws_module_not_found() throws Exception {
        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(new MemoryMount()))
            .bios("require('/nope');")
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertTrue(result.isError(), "missing module should error");
            assertTrue(result.getMessage() != null && result.getMessage().contains("MODULE_NOT_FOUND"),
                "error should mention MODULE_NOT_FOUND, got: " + result.getMessage());
        } finally {
            machine.close();
        }
    }
}
