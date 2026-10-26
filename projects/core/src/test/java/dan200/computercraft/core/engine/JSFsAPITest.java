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
        fileSystem.mount("rom", "rom", new MemoryMount().addFile("readme.txt", "hello"));
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
            assertEquals(List.of("entries:dir,rom"), probe.values, "callback should be parked in pause()");

            run(machine, TICK);
            assertEquals(List.of("entries:dir,rom", "resumed"), probe.values);
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
            assertEquals(List.of("true:ENOENT: no such file or directory, open '/missing.txt':null", "stat:true"), probe.values);
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
                "nested:ENOENT: no such file or directory, mkdir '/a/b'",
                "nested-recursive:ok",
                "exists:EEXIST: file already exists, mkdir '/a'",
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
                "missing:ENOENT: no such file or directory, rm '/nope'",
                "missing-force:ok",
                "dir:EISDIR: illegal operation on a directory, rm '/d'",
                "dir-force:EISDIR: illegal operation on a directory, rm '/d'",
                "file:ok",
                "dir-recursive:ok",
                "left:rom"
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
                "dir:EISDIR: illegal operation on a directory, cp '/src' -> '/dst'",
                "copyFile-dir:EISDIR: illegal operation on a directory, copyfile '/src' -> '/dst'",
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
                "mkdir:null", "cp:null", "rm:null", "rm-force:null", "rm-dir:EISDIR: illegal operation on a directory, rm '/c'"
            ), probe.values);
        } finally {
            machine.close();
        }
    }

    /** Run a bios and return what it recorded, failing if the machine errors. */
    private List<Object> runSync(String bios) throws Exception {
        var machine = machine(bios);
        try {
            run(machine, null);
            return List.copyOf(probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void errors_carry_node_codes() throws Exception {
        var values = runSync("""
            function code(name, fn) {
                try { fn(); probe.record(name + ':ok'); }
                catch (e) { probe.record(name + ':' + e.code + ':' + e.syscall + ':' + e.path + ':' + e.errno + (e.dest ? ':' + e.dest : '')); }
            }
            fs.mkdirSync('d');
            fs.writeFileSync('d/f.txt', 'x');
            fs.writeFileSync('g.txt', 'x');
            code('read-missing', function () { fs.readFileSync('nope.txt'); });
            code('read-dir', function () { fs.readFileSync('d'); });
            code('readdir-file', function () { fs.readdirSync('g.txt'); });
            code('mkdir-exists', function () { fs.mkdirSync('d'); });
            code('mkdir-under-file', function () { fs.mkdirSync('g.txt/x', { recursive: true }); });
            code('rmdir-nonempty', function () { fs.rmdirSync('d'); });
            code('rmdir-file', function () { fs.rmdirSync('g.txt'); });
            code('unlink-dir', function () { fs.unlinkSync('d'); });
            code('write-rom', function () { fs.writeFileSync('rom/x.txt', 'x'); });
            code('rm-rom', function () { fs.rmSync('rom/readme.txt'); });
            code('write-no-parent', function () { fs.writeFileSync('missing/x.txt', 'x'); });
            code('rename-missing', function () { fs.renameSync('nope', 'other'); });
            code('copy-excl', function () { fs.copyFileSync('g.txt', 'd/f.txt', fs.constants.COPYFILE_EXCL); });
            code('stat-missing', function () { fs.statSync('nope'); });
            code('access-rom-w', function () { fs.accessSync('rom/readme.txt', fs.constants.W_OK); });
            code('access-rom-r', function () { fs.accessSync('rom/readme.txt', fs.R_OK); });
            code('realpath-missing', function () { fs.realpathSync('nope'); });
            """);
        assertEquals(List.of(
            "read-missing:ENOENT:open:/nope.txt:-2",
            "read-dir:EISDIR:read:/d:-21",
            "readdir-file:ENOTDIR:scandir:/g.txt:-20",
            "mkdir-exists:EEXIST:mkdir:/d:-17",
            "mkdir-under-file:ENOTDIR:mkdir:/g.txt/x:-20",
            "rmdir-nonempty:ENOTEMPTY:rmdir:/d:-39",
            "rmdir-file:ENOTDIR:rmdir:/g.txt:-20",
            "unlink-dir:EISDIR:unlink:/d:-21",
            "write-rom:EROFS:open:/rom/x.txt:-30",
            "rm-rom:EROFS:rm:/rom/readme.txt:-30",
            "write-no-parent:ENOENT:open:/missing/x.txt:-2",
            "rename-missing:ENOENT:rename:/nope:-2:/other",
            "copy-excl:EEXIST:copyfile:/g.txt:-17:/d/f.txt",
            "stat-missing:ENOENT:stat:/nope:-2",
            "access-rom-w:EROFS:access:/rom/readme.txt:-30",
            "access-rom-r:ok",
            "realpath-missing:ENOENT:realpath:/nope:-2"
        ), values);
    }

    @Test
    void callback_errors_carry_codes() throws Exception {
        var machine = machine("""
            fs.readFile('nope.txt', 'utf8', function (err) { probe.record('read:' + err.code + ':' + err.path); });
            fs.mkdir('a/b', function (err) { probe.record('mkdir:' + err.code); });
            fs.access('nope', function (err) { probe.record('access:' + err.code); });
            fs.exists('rom', function (exists) { probe.record('exists:' + exists); });
            """);
        try {
            run(machine, null);
            run(machine, TICK);
            assertEquals(List.of("read:ENOENT:/nope.txt", "mkdir:ENOENT", "access:ENOENT", "exists:true"), probe.values);
        } finally {
            machine.close();
        }
    }

    @Test
    void read_and_write_accept_options_objects() throws Exception {
        var values = runSync("""
            fs.writeFileSync('a.txt', 'héllo', { encoding: 'utf8' });
            probe.record('utf8:' + fs.readFileSync('a.txt', { encoding: 'utf8', flag: 'r' }));
            probe.record('latin1:' + fs.readFileSync('a.txt', 'latin1').length);
            probe.record('hex:' + fs.readFileSync('a.txt', 'hex'));
            fs.writeFileSync('b.bin', [104, 105]);
            probe.record('bytes:' + fs.readFileSync('b.bin'));
            fs.writeFileSync('c.txt', 'aGk=', 'base64');
            probe.record('base64:' + fs.readFileSync('c.txt') + ':' + fs.readFileSync('c.txt', 'base64'));
            fs.writeFileSync('a.txt', '!', { flag: 'a' });
            fs.appendFileSync('a.txt', '?', { encoding: 'utf8' });
            probe.record('append:' + fs.readFileSync('a.txt'));
            check('wx', function () { fs.writeFileSync('a.txt', 'x', { flag: 'wx' }); });
            check('bad-flag', function () { fs.writeFileSync('a.txt', 'x', { flag: 'r' }); });
            check('bad-encoding', function () { fs.readFileSync('a.txt', 'utf32'); });
            """);
        assertEquals(List.of(
            "utf8:héllo",
            "latin1:6",
            "hex:68c3a96c6c6f",
            "bytes:hi",
            "base64:hi:aGk=",
            "append:héllo!?",
            "wx:EEXIST: file already exists, open '/a.txt'",
            "bad-flag:The value \"r\" is not supported for the \"flag\" option",
            "bad-encoding:Unknown encoding: utf32"
        ), values);
    }

    @Test
    void readdir_with_file_types_and_recursive() throws Exception {
        var values = runSync("""
            fs.mkdirSync('d/e', { recursive: true });
            fs.writeFileSync('d/f.txt', 'x');
            fs.writeFileSync('d/e/g.txt', 'x');
            var dirents = fs.readdirSync('d', { withFileTypes: true });
            probe.record(dirents.map(function (d) {
                return d.name + ':' + d.parentPath + ':' + d.isDirectory() + ':' + d.isFile() + ':' + d.isSymbolicLink();
            }).join(','));
            probe.record('recursive:' + fs.readdirSync('d', { recursive: true }).join(','));
            """);
        assertEquals(List.of("e:/d:true:false:false,f.txt:/d:false:true:false", "recursive:e,e/g.txt,f.txt"), values);
    }

    @Test
    void stat_has_node_methods() throws Exception {
        var values = runSync("""
            fs.writeFileSync('a.txt', 'hello');
            var f = fs.statSync('a.txt');
            var d = fs.lstatSync('rom');
            probe.record(f.isFile() + ':' + f.isDirectory() + ':' + f.size + ':' + (f.mode & 0x1ff).toString(8) + ':' + f.readOnly);
            probe.record(d.isFile() + ':' + d.isDirectory() + ':' + (d.mode & 0x1ff).toString(8) + ':' + d.readOnly);
            probe.record('date:' + (typeof new Date(f.mtimeMs).getTime()));
            probe.record('missing:' + fs.statSync('nope', { throwIfNoEntry: false }));
            """);
        assertEquals(List.of("true:false:5:644:false", "false:true:555:true", "date:number", "missing:undefined"), values);
    }

    @Test
    void mkdir_recursive_returns_first_created_path() throws Exception {
        var values = runSync("""
            probe.record('first:' + fs.mkdirSync('a/b/c', { recursive: true }));
            probe.record('again:' + fs.mkdirSync('a/b/c', { recursive: true }));
            probe.record('partial:' + fs.mkdirSync('a/x/y', { recursive: true }));
            probe.record('plain:' + fs.mkdirSync('z'));
            """);
        assertEquals(List.of("first:/a", "again:undefined", "partial:/a/x", "plain:undefined"), values);
    }

    @Test
    void rename_and_copy_overwrite_like_node() throws Exception {
        var values = runSync("""
            fs.writeFileSync('a.txt', 'A');
            fs.writeFileSync('b.txt', 'B');
            fs.renameSync('a.txt', 'b.txt');
            probe.record('rename:' + fs.existsSync('a.txt') + ':' + fs.readFileSync('b.txt'));
            fs.writeFileSync('c.txt', 'C');
            fs.copyFileSync('c.txt', 'b.txt');
            probe.record('copyFile:' + fs.readFileSync('b.txt'));
            fs.mkdirSync('src/sub', { recursive: true });
            fs.writeFileSync('src/sub/f.txt', 'new');
            fs.mkdirSync('dst/sub', { recursive: true });
            fs.writeFileSync('dst/sub/f.txt', 'old');
            fs.writeFileSync('dst/keep.txt', 'keep');
            fs.cpSync('src', 'dst', { recursive: true, force: false });
            probe.record('no-force:' + fs.readFileSync('dst/sub/f.txt'));
            check('errorOnExist', function () { fs.cpSync('src', 'dst', { recursive: true, force: false, errorOnExist: true }); });
            fs.cpSync('src', 'dst', { recursive: true });
            probe.record('merged:' + fs.readFileSync('dst/sub/f.txt') + ':' + fs.readFileSync('dst/keep.txt'));
            fs.cpSync('c.txt', 'deep/er/c.txt');
            probe.record('parents:' + fs.readFileSync('deep/er/c.txt'));
            check('into-self', function () { fs.cpSync('src', 'src/sub/x', { recursive: true }); });
            """);
        assertEquals(List.of(
            "rename:false:A",
            "copyFile:C",
            "no-force:old",
            "errorOnExist:EEXIST: file already exists, cp '/src/sub/f.txt' -> '/dst/sub/f.txt'",
            "merged:new:keep",
            "parents:C",
            "into-self:EINVAL: invalid argument, cp '/src' -> '/src/sub/x'"
        ), values);
    }

    @Test
    void constants_and_node_style_usage() throws Exception {
        var values = runSync("""
            probe.record('constants:' + fs.constants.F_OK + fs.constants.R_OK + fs.constants.W_OK + fs.constants.X_OK
                + ':' + fs.constants.COPYFILE_EXCL + ':' + fs.F_OK);
            // A typical Node snippet: create a config dir, write JSON, read it back.
            var dir = '/etc/app';
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(dir + '/config.json', JSON.stringify({ a: 1 }), 'utf8');
            var cfg = JSON.parse(fs.readFileSync(dir + '/config.json', 'utf8'));
            probe.record('json:' + cfg.a);
            try { fs.readFileSync('/nope.json'); } catch (e) { if (e.code === 'ENOENT') probe.record('enoent-handled'); }
            probe.record('realpath:' + fs.realpathSync('etc/./app/../app'));
            fs.unlinkSync(dir + '/config.json');
            fs.rmdirSync(dir);
            probe.record('left:' + fs.readdirSync('/etc').length);
            """);
        assertEquals(List.of("constants:0421:1:0", "json:1", "enoent-handled", "realpath:/etc/app", "left:0"), values);
    }
}
