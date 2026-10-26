// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.MemoryMount;
import dan200.computercraft.core.methods.ApiMethod;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Phase 8.5 — {@code require()} loads file-based modules from the CC {@link FileSystem}, executes them, returns their
 * {@code module.exports}, and caches the result. Modules are cached before their body runs, so circular requires see
 * partial exports; {@code require.uncached} runs a module fresh every time (used for programs).
 */
class JSRequireTest {
    private static FileSystem fsWith(MemoryMount mount) throws Exception {
        return new FileSystem("hdd", mount);
    }

    /** A {@code writer.write(path, contents)} API that edits the mount from JS, simulating an editor. */
    private static Map<String, ApiMethod> writerMethods(MemoryMount mount) {
        return Map.of("write", (target, context, args) -> {
            mount.addFile(args.getString(0), args.getString(1));
            return MethodResult.of();
        });
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
    @Test
    void circular_requires_see_partial_exports() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("a.js", """
            exports.early = 'a-early';
            var b = require('./b');
            exports.fromB = b.sawA;
            exports.late = 'a-late';
            """);
        mount.addFile("b.js", """
            var a = require('./a');
            exports.sawA = a.early + '/' + a.late;
            """);
        var rec = new JSMachineBuilder.Recorder();

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(rec, rec.methods())
            .bios("""
                var a = require('/a');
                var probe = require('probe');
                probe.record(a.fromB);
                probe.record(a.late);
                probe.record(require('/b').sawA);
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "circular require should terminate: " + result.getMessage());
            assertEquals(List.of("a-early/undefined", "a-late", "a-early/undefined"), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void self_require_returns_partial_exports() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("self.js", """
            exports.before = 1;
            exports.selfBefore = require('/self').before;
            """);
        var rec = new JSMachineBuilder.Recorder();

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(rec, rec.methods())
            .bios("require('probe').record(require('/self').selfBefore);")
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "self require should terminate: " + result.getMessage());
            assertEquals(List.of(1L), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void reassigned_module_exports_are_cached() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("fn.js", "module.exports = function () { return 'called'; };");

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .bios("""
                var f = require('/fn');
                if (typeof f !== 'function' || f() !== 'called') throw new Error('expected reassigned exports');
                if (require('/fn') !== f) throw new Error('expected cached reassigned exports');
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), result.getMessage());
        } finally {
            machine.close();
        }
    }

    @Test
    void throwing_module_is_evicted_from_cache() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("flaky.js", """
            globalThis.flakyRuns = (globalThis.flakyRuns || 0) + 1;
            if (globalThis.flakyRuns === 1) throw new Error('first run fails');
            exports.ok = true;
            """);

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .bios("""
                var threw = false;
                try { require('/flaky'); } catch (e) { threw = true; }
                if (!threw) throw new Error('expected first require to throw');
                if (require('/flaky').ok !== true) throw new Error('expected module to be re-executed');
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), result.getMessage());
        } finally {
            machine.close();
        }
    }

    @Test
    void uncached_load_runs_fresh_each_time() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("prog.js", """
            globalThis.progRuns = (globalThis.progRuns || 0) + 1;
            exports.run = globalThis.progRuns;
            """);
        var rec = new JSMachineBuilder.Recorder();

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(rec, rec.methods())
            .bios("""
                var probe = require('probe');
                probe.record(require.uncached('/prog').run);
                probe.record(require.uncached('/prog').run);
                // Uncached loads must not populate the cache either.
                var cached = require('/prog');
                probe.record(cached.run);
                probe.record(require('/prog') === cached);
                // ...nor reuse an existing cache entry.
                probe.record(require.uncached('/prog').run);
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), "uncached load should succeed: " + result.getMessage());
            assertEquals(List.of(1L, 2L, 3L, true, 4L), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void uncached_load_sees_edited_source() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("prog.js", "exports.v = 'old';");
        IComputerAPI writer = () -> new String[]{ "writer" };

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(writer, writerMethods(mount))
            .bios("""
                if (require.uncached('/prog').v !== 'old') throw new Error('expected old');
                require('writer').write('prog.js', "exports.v = 'new';");
                if (require.uncached('/prog').v !== 'new') throw new Error('expected edited source');
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), result.getMessage());
        } finally {
            machine.close();
        }
    }

    @Test
    void resolve_distinguishes_missing_program_from_missing_dependency() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("bin/broken.js", "require('/does-not-exist');");
        var rec = new JSMachineBuilder.Recorder();

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(rec, rec.methods())
            .bios("""
                var probe = require('probe');
                require.paths = ['/bin'];
                probe.record(require.resolve('broken'));
                probe.record(require.resolve('probe'));
                try { require.resolve('missing'); probe.record('resolved?'); }
                catch (e) { probe.record(String(e.message).indexOf('MODULE_NOT_FOUND') >= 0); }
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), result.getMessage());
            assertEquals(List.of("bin/broken.js", "probe", true), rec.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void module_errors_report_module_path_and_line() throws Exception {
        var mount = new MemoryMount();
        mount.addFile("bad.js", "var x = 1;\n\nthrow new Error('boom');");
        var rec = new JSMachineBuilder.Recorder();

        var machine = new JSMachineBuilder()
            .fileSystem(fsWith(mount))
            .api(rec, rec.methods())
            .bios("""
                var probe = require('probe');
                try { require.uncached('/bad'); } catch (e) {
                    probe.record(e.message);
                    probe.record(String(e.stack).indexOf('at /bad.js:3') >= 0);
                }
                try { require('/missing'); } catch (e) { probe.record(e.message); }
                """)
            .build();
        try {
            var result = machine.handleEvent(null, null);
            assertFalse(result.isError(), result.getMessage());
            assertEquals(List.of("boom", true, "MODULE_NOT_FOUND: /missing"), rec.values);
        } finally {
            machine.close();
        }
    }
}
