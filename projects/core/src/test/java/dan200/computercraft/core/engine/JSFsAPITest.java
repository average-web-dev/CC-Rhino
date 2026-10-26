// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.apis.FSAPI;
import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.MemoryMount;
import dan200.computercraft.test.core.apis.BasicApiEnvironment;
import dan200.computercraft.test.core.computer.BasicEnvironment;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * The {@code fs} module: callback variants deliver {@code (err, result)} through the event loop (after the call
 * returns, able to block), and the {@code recursive} / {@code force} options of {@code mkdir}, {@code rm} and
 * {@code cp}.
 */
class JSFsAPITest {
    private static final String TICK = "cc:js-tick";

    /** Helper prepended to every bios: runs {@code fn} and records {@code name:ok} or {@code name:<error message>}. */
    private static final String PRELUDE = """
        var fs = require('fs');
        var probe = require('probe');
        function check(name, fn) {
            try { fn(); probe.record(name + ':ok'); } catch (e) { probe.record(name + ':' + e.message); }
        }
        """;

    private final JSMachineBuilder.Recorder probe = new JSMachineBuilder.Recorder();

    private JSMachine machine(String bios) throws Exception {
        var fileSystem = new FileSystem("hdd", new MemoryMount());
        var fsApi = new FSAPI(new BasicApiEnvironment(new BasicEnvironment()) {
            @Override
            public FileSystem getFileSystem() {
                return fileSystem;
            }

            @Override
            public void queueEvent(String event, @Nullable Object... args) {
            }
        });
        fsApi.startup();

        return new JSMachineBuilder()
            .api(fsApi)
            .api(probe, probe.methods())
            // pause() parks the caller until the next tick, standing in for any blocking API.
            .api("sleepy", Map.of("pause", (target, context, args) -> MethodResult.yield()))
            .bios(PRELUDE + bios)
            .build();
    }

    private static void run(JSMachine machine, @Nullable String event) {
        var result = machine.handleEvent(event, null);
        assertFalse(result.isError(), "machine should not error: " + result.getMessage());
    }

    @Test
    void callback_runs_after_the_call_returns() throws Exception {
        var machine = machine("""
            fs.writeFileSync('a.txt', 'hi');
            fs.readFile('a.txt', function (err, data) { probe.record('cb:' + err + ':' + data); });
            probe.record('returned');
            """);
        try {
            run(machine, null);
            assertEquals(List.of("returned"), probe.values, "callback must not run inside readFile()");

            run(machine, TICK);
            assertEquals(List.of("returned", "cb:null:hi"), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void callback_may_call_blocking_apis() throws Exception {
        var machine = machine("""
            var sleepy = require('sleepy');
            fs.mkdirSync('dir');
            fs.readdir('', function (err, entries) {
                probe.record('entries:' + entries.join(','));
                sleepy.pause();
                probe.record('resumed');
            });
            """);
        try {
            run(machine, null);
            run(machine, TICK);
            assertEquals(List.of("entries:dir"), probe.values, "callback should be parked in pause()");

            run(machine, TICK);
            assertEquals(List.of("entries:dir", "resumed"), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void errors_arrive_as_err() throws Exception {
        var machine = machine("""
            fs.readFile('missing.txt', function (err, data) {
                probe.record((err instanceof Error) + ':' + err.message + ':' + data);
            });
            fs.stat('missing.txt', function (err) { probe.record('stat:' + (err instanceof Error)); });
            """);
        try {
            run(machine, null);
            run(machine, TICK);
            assertEquals(List.of("true:/missing.txt: No such file:null", "stat:true"), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void mkdir_requires_parent_unless_recursive() throws Exception {
        var machine = machine("""
            check('nested', function () { fs.mkdirSync('a/b'); });
            check('nested-recursive', function () { fs.mkdirSync('a/b', { recursive: true }); });
            check('exists', function () { fs.mkdirSync('a'); });
            check('exists-recursive', function () { fs.mkdirSync('a/b', { recursive: true }); });
            check('child', function () { fs.mkdirSync('a/c'); });
            """);
        try {
            run(machine, null);
            assertEquals(List.of(
                "nested:/a: No such file",
                "nested-recursive:ok",
                "exists:/a: File exists",
                "exists-recursive:ok",
                "child:ok"
            ), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void rm_honours_recursive_and_force() throws Exception {
        var machine = machine("""
            fs.mkdirSync('d');
            fs.writeFileSync('d/f.txt', 'x');
            fs.writeFileSync('g.txt', 'x');
            check('missing', function () { fs.rmSync('nope'); });
            check('missing-force', function () { fs.rmSync('nope', { force: true }); });
            check('dir', function () { fs.rmSync('d'); });
            check('dir-force', function () { fs.rmSync('d', { force: true }); });
            check('file', function () { fs.rmSync('g.txt'); });
            check('dir-recursive', function () { fs.rmSync('d', { recursive: true }); });
            probe.record('left:' + fs.readdirSync('').join(','));
            """);
        try {
            run(machine, null);
            assertEquals(List.of(
                "missing:/nope: No such file",
                "missing-force:ok",
                "dir:/d: Is a directory",
                "dir-force:/d: Is a directory",
                "file:ok",
                "dir-recursive:ok",
                "left:"
            ), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void cp_copies_directories_only_when_recursive() throws Exception {
        var machine = machine("""
            fs.mkdirSync('src');
            fs.writeFileSync('src/f.txt', 'x');
            check('dir', function () { fs.cpSync('src', 'dst'); });
            check('copyFile-dir', function () { fs.copyFileSync('src', 'dst'); });
            check('dir-recursive', function () { fs.cpSync('src', 'dst', { recursive: true }); });
            check('file', function () { fs.copyFileSync('src/f.txt', 'g.txt'); });
            probe.record('copied:' + fs.readFileSync('dst/f.txt') + fs.readFileSync('g.txt'));
            """);
        try {
            run(machine, null);
            assertEquals(List.of(
                "dir:/src: Is a directory",
                "copyFile-dir:/src: Is a directory",
                "dir-recursive:ok",
                "file:ok",
                "copied:xx"
            ), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void callback_variants_accept_options() throws Exception {
        var machine = machine("""
            fs.mkdir('a/b', { recursive: true }, function (err) {
                probe.record('mkdir:' + err);
                fs.cp('a', 'c', { recursive: true }, function (err) {
                    probe.record('cp:' + err);
                    fs.rm('a', { recursive: true }, function (err) {
                        probe.record('rm:' + err);
                        fs.rm('a', { force: true }, function (err) {
                            probe.record('rm-force:' + err);
                            fs.rm('c', function (err) { probe.record('rm-dir:' + err.message); });
                        });
                    });
                });
            });
            """);
        try {
            run(machine, null);
            for (var i = 0; i < 5; i++) run(machine, TICK);
            assertEquals(List.of(
                "mkdir:null", "cp:null", "rm:null", "rm-force:null", "rm-dir:/c: Is a directory"
            ), probe.values);
        } finally {
            machine.close();
        }
    }
}
