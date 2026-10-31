// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.core.engine.JSSandboxTest;
import dan200.computercraft.core.filesystem.MemoryMount;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.TreeSet;

import static dan200.computercraft.core.computer.TerminalHarness.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * End-to-end tests of the real boot (bios → OS → bash) with Node-style stdio (#34): the globals the bios leaves, bash
 * on readline (editing, history, completion, Ctrl+C), and programs using readline, stdin and process.exit as
 * foreground jobs.
 */
class StdioShellTest {
    private static MemoryMount programs() {
        return new MemoryMount()
            .addFile("globals.js", """
                exports.main = function () {
                    require('probe').record(Object.getOwnPropertyNames(globalThis).join(','));
                };
                """)
            .addFile("ask.js", """
                var readline = require('readline');
                exports.main = function () {
                    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                    var name = rl.question('Name? ');
                    console.log('Hi ' + name);
                    rl.close();
                };
                """)
            .addFile("repl.js", """
                var rl = require('readline').createInterface({
                    input: process.stdin, output: process.stdout, prompt: 'r> ',
                });
                rl.on('line', function (line) {
                    if (line === 'quit') { rl.close(); return; }
                    console.log('got ' + line);
                    rl.prompt();
                });
                rl.prompt();
                """)
            .addFile("upper.js", """
                process.stdin.on('data', function (d) {
                    if (d === 'q\\n') { process.stdin.pause(); return; }
                    process.stdout.write('> ' + d.toUpperCase());
                });
                """)
            .addFile("exit.js", """
                console.log('before');
                process.exit(3);
                console.log('after');
                """)
            .addFile("exitlater.js", """
                process.stdin.on('data', function () { process.exit(0); });
                """)
            .addFile("args.js", """
                exports.main = function (args, cwd) {
                    console.log(JSON.stringify(process.argv.slice(2)) + ' ' + process.cwd() + ' ' + JSON.stringify(args));
                    process.chdir('/rom');
                };
                """)
            // Job lifetime (#46): pending async work keeps a program alive, then the job's thread is stopped.
            .addFile("pending.js", """
                var sp = require('system/promises');
                function aMain() {
                    return sp.sleep(20).then(function () { console.log('Test complete.'); });
                }
                exports.main = function () {
                    aMain().catch(function (e) { console.error(e); });
                };
                """)
            .addFile("asyncmain.js", """
                var sp = require('system/promises');
                // What tsc makes of `async main() { await sleep(5); console.log('awaited'); }`.
                exports.main = function () {
                    return require('async').run(function* () {
                        yield sp.sleep(5);
                        console.log('awaited');
                    });
                };
                """)
            .addFile("asyncfail.js", """
                exports.main = function () {
                    return require('system/promises').sleep(2).then(function () { throw new Error('async boom'); });
                };
                """)
            .addFile("exitcode.js", """
                var bash = require('/rom/bin/bash');
                exports.main = function (args) {
                    bash.run(args[0]);
                    require('probe').record(args[0] + ' ' + bash.getExitCode());
                };
                """)
            .addFile("timer.js", """
                exports.main = function () {
                    setTimeout(function () { console.log('timer fired'); }, 500);
                };
                """)
            .addFile("unref.js", """
                setTimeout(function () { console.log('unref fired'); }, 500).unref();
                setInterval(function () { console.log('interval fired'); }, 100).unref();
                console.log('unref started');
                """)
            .addFile("listener.js", """
                require('events').on('char', function () { console.log('leftover listener'); });
                require('events').on('timer', function () { console.log('leftover listener'); });
                console.log('listening');
                """)
            .addFile("ticker.js", """
                setInterval(function () { console.log('tick'); }, 100);
                require('system/promises').sleep(40).then(function () { console.log('late'); });
                """)
            .addFile("exitpending.js", """
                setTimeout(function () { console.log('nope'); }, 1000);
                setTimeout(function () { process.exit(4); }, 100);
                """)
            .addFile("children.js", """
                var parallel = require('parallel');
                parallel.spawn(function () {
                    parallel.spawn(function () { require('system').sleep(10); console.log('grandchild done'); });
                    require('system').sleep(5);
                    console.log('child done');
                });
                console.log('main done');
                """);
    }

    /** Wait until the cursor sits on an empty prompt for {@code cwd}. */
    private static void waitForPrompt(TerminalHarness h, String cwd) {
        h.waitFor("an empty '" + cwd + " $' prompt", x -> x.line(x.cursorY()).equals(cwd + " $"));
    }

    private static int count(TerminalHarness h, String line) {
        var n = 0;
        for (var y = 0; y < 19; y++) if (h.line(y).equals(line)) n++;
        return n;
    }

    @Test
    void boot_leaves_only_the_node_globals() {
        try (var h = TerminalHarness.boot(programs())) {
            waitForPrompt(h, "/");
            h.enter("/globals.js");
            h.waitForProbe(1);

            var expected = new TreeSet<>(JSSandboxTest.ALLOWED_GLOBALS);
            expected.addAll(JSSandboxTest.BIOS_GLOBALS);
            var actual = new TreeSet<>(Arrays.asList(((String) h.probe().get(0)).split(",")));
            assertEquals(expected, actual, "globals after the real boot");
        }
    }

    @Test
    void bash_editing_history_completion_and_builtins() {
        try (var h = TerminalHarness.boot(programs())) {
            waitForPrompt(h, "/");

            h.enter("echo hello world");
            h.waitForText("hello world");
            waitForPrompt(h, "/");

            // Line editing: Left, insert; Home, insert; End, insert.
            h.type("cho wrld");
            h.key(KEY_LEFT);
            h.key(KEY_LEFT);
            h.key(KEY_LEFT);
            h.type("o");
            h.key(KEY_HOME);
            h.type("e");
            h.key(KEY_END);
            h.type("!");
            h.key(KEY_ENTER);
            // Wait for the output line itself: the echoed command line "/ $ echo world!" also contains "world!".
            h.waitFor("the edited command's output", x -> count(x, "world!") == 1);
            waitForPrompt(h, "/");

            // History: Up recalls the last command.
            h.key(KEY_UP);
            h.key(KEY_ENTER);
            h.waitFor("the command to run again", x -> count(x, "world!") == 2);
            waitForPrompt(h, "/");

            // Tab completes the command name (with a trailing space).
            h.type("ech");
            h.key(KEY_TAB);
            h.enter("tabbed");
            h.waitFor("completed command output", x -> count(x, "tabbed") == 1);
            waitForPrompt(h, "/");

            // Ctrl+C drops the line.
            h.type("abc");
            h.ctrl('C');
            h.waitForText("/ $ abc^C");
            waitForPrompt(h, "/");

            // Errors go to stderr, in red.
            h.enter("nope");
            h.waitForText("bash: nope: command not found");
            assertEquals('e', h.colours(h.rowOf("bash: nope")).charAt(0), "stderr is red");
            waitForPrompt(h, "/");

            h.enter("mkdir /dir");
            waitForPrompt(h, "/");
            h.enter("cd dir");
            waitForPrompt(h, "/dir");
            h.enter("cd missing");
            h.waitForText("bash: cd: no such file or directory: missing");
            waitForPrompt(h, "/dir");

            // A program gets argv and the shell's cwd, and cannot change the shell's cwd.
            h.enter("/args.js a b");
            h.waitForText("[\"a\",\"b\"] /dir [\"a\",\"b\"]");
            waitForPrompt(h, "/dir");
        }
    }

    /** Assert that the prompt (where the cursor is) is on the row right after {@code text}. */
    private static void assertBeforePrompt(TerminalHarness h, String text) {
        var row = h.rowOf(text);
        assertTrue(row >= 0, "'" + text + "' is on screen\n" + h.dump());
        assertEquals(row + 1, h.cursorY(), "the prompt follows '" + text + "'\n" + h.dump());
    }

    @Test
    void pending_work_keeps_a_program_alive() {
        try (var h = TerminalHarness.boot(programs())) {
            waitForPrompt(h, "/");

            // main() returns at once; the pending /promises sleep keeps the job alive, so its output comes before
            // the prompt (and the prompt only after it).
            h.enter("/pending.js");
            h.ticks(10);
            assertNotEquals("/ $", h.line(h.cursorY()), "no prompt while the program has pending work\n" + h.dump());
            h.waitForText("Test complete.");
            waitForPrompt(h, "/");
            assertBeforePrompt(h, "Test complete.");

            // An async main is awaited.
            h.enter("clear");
            waitForPrompt(h, "/");
            h.enter("/asyncmain.js");
            h.waitForText("awaited");
            waitForPrompt(h, "/");
            assertBeforePrompt(h, "awaited");

            // A rejected async main is the program's error, with exit code 1.
            h.enter("/exitcode.js /asyncfail.js");
            h.waitForText("async boom");
            h.waitForProbe(1);
            assertEquals("/asyncfail.js 1", h.probe().get(0));
            assertEquals('e', h.colours(h.rowOf("async boom")).charAt(0), "reported on stderr");
            waitForPrompt(h, "/");

            // A ref'd timer keeps it alive, unref'd ones do not (and never fire afterwards).
            h.enter("clear");
            waitForPrompt(h, "/");
            h.enter("/timer.js");
            h.waitForText("timer fired");
            waitForPrompt(h, "/");
            assertBeforePrompt(h, "timer fired");

            h.enter("/unref.js");
            h.waitForText("unref started");
            waitForPrompt(h, "/");
            h.ticks(20);
            assertEquals(-1, h.rowOf("unref fired"), h.dump());
            assertEquals(-1, h.rowOf("interval fired"), h.dump());

            // Listeners do not keep a program alive, and a finished program's listeners are gone.
            h.enter("clear");
            waitForPrompt(h, "/");
            h.enter("/listener.js");
            h.waitForText("listening");
            waitForPrompt(h, "/");
            h.type("x");
            h.ticks(5);
            assertEquals(-1, h.rowOf("leftover"), h.dump());
            h.ctrl('U');

            // Child threads keep it alive.
            h.enter("/children.js");
            h.waitForText("grandchild done");
            waitForPrompt(h, "/");
            assertBeforePrompt(h, "grandchild done");
            assertTrue(h.rowOf("main done") < h.rowOf("child done"), h.dump());

            // process.exit ends it at once, discarding its pending work.
            h.enter("clear");
            waitForPrompt(h, "/");
            h.enter("/exitcode.js /exitpending.js");
            h.waitForProbe(2);
            assertEquals("/exitpending.js 4", h.probe().get(1));
            waitForPrompt(h, "/");
            h.ticks(25);
            assertEquals(-1, h.rowOf("nope"), h.dump());

            // Ctrl+C (cooked mode) while it has pending async work: back to the prompt, and nothing prints afterwards.
            h.enter("clear");
            waitForPrompt(h, "/");
            h.enter("/ticker.js");
            h.waitForText("tick");
            h.ctrl(KEY_C);
            h.waitForText("^C");
            h.waitForText("Terminated");
            waitForPrompt(h, "/");
            var screen = h.screen();
            h.ticks(50);
            assertEquals(screen, h.screen(), "nothing runs after the job was terminated");
            assertEquals(-1, h.rowOf("late"), h.dump());
        }
    }

    @Test
    void programs_read_stdin_as_foreground_jobs() {
        try (var h = TerminalHarness.boot(programs())) {
            waitForPrompt(h, "/");

            // A blocking question, then the program ends by itself.
            h.enter("/ask.js");
            h.waitForText("Name?");
            h.enter("Bob");
            h.waitForText("Hi Bob");
            waitForPrompt(h, "/");

            // A Node-style program: it returns at once but runs on while its interface is open.
            h.enter("/repl.js");
            h.waitFor("the program's prompt", x -> x.line(x.cursorY()).equals("r>"));
            h.enter("a");
            h.waitForText("got a");
            h.waitFor("the program's prompt again", x -> x.line(x.cursorY()).equals("r>"));
            h.enter("quit");
            waitForPrompt(h, "/");

            // Ctrl+C in a readline program (raw mode): as in Node, it closes the interface and the program ends.
            h.enter("/repl.js");
            h.waitFor("the program's prompt", x -> x.line(x.cursorY()).equals("r>"));
            h.ctrl(KEY_C);
            waitForPrompt(h, "/");

            // The terminate button ends it while it waits for input.
            h.enter("/repl.js");
            h.waitFor("the program's prompt", x -> x.line(x.cursorY()).equals("r>"));
            h.terminate();
            h.waitForText("Terminated");
            assertEquals('e', h.colours(h.rowOf("Terminated")).charAt(0));
            waitForPrompt(h, "/");

            // The shell still works, and its history is intact.
            h.key(KEY_UP);
            h.waitFor("a recalled command", x -> x.line(x.cursorY()).equals("/ $ /repl.js"));
            h.ctrl('U');
            h.enter("echo still alive");
            h.waitForText("still alive");
            waitForPrompt(h, "/");

            // Cooked stdin: echoed, delivered as lines; pausing stdin ends the program.
            h.enter("/upper.js");
            h.ticks(5);
            h.enter("abc");
            h.waitForText("> ABC");
            h.enter("q");
            waitForPrompt(h, "/");

            // process.exit ends the program at once, also from a listener.
            h.enter("/exit.js");
            h.waitForText("before");
            waitForPrompt(h, "/");
            assertEquals(-1, h.rowOf("after"), h.dump());
            assertEquals(-1, h.rowOf("process.exit"), "exit is not reported as an error\n" + h.dump());

            h.enter("/exitlater.js");
            h.ticks(5);
            h.enter("x");
            waitForPrompt(h, "/");
            assertEquals(-1, h.rowOf("process.exit"), h.dump());
        }
    }

    /** edit reads keys through a Term on process.stdin: typing, Ctrl+S saves, Ctrl+Q exits. */
    @Test
    void edit_saves_and_exits() {
        try (var h = TerminalHarness.boot(programs())) {
            waitForPrompt(h, "/");
            h.enter("edit /notes.txt");
            h.waitFor("the editor", x -> x.screen().contains("/notes.txt"));
            h.type("hello");
            h.key(KEY_ENTER);
            h.type("world");
            h.waitFor("the typed text", x -> x.line(1).startsWith("world"));
            h.ctrl('S');
            h.waitForText("Saved /notes.txt");
            h.ctrl('Q');
            waitForPrompt(h, "/");
            h.enter("cat /notes.txt");
            h.waitForText("world");
            assertTrue(h.screen().contains("hello"), h.dump());
        }
    }

    /**
     * Alt+2 shows the second console with a shell of its own; terminating only reaches the visible console; `exit`
     * there clears it and shows the first console again.
     */
    @Test
    void virtual_consoles() {
        try (var h = TerminalHarness.boot(programs()
            .addFile("wait.js", "exports.main = function () { require('system').sleep(40); console.log('slept'); };"))) {
            waitForPrompt(h, "/");
            h.enter("/wait.js");
            h.ticks(3);

            h.alt('2');
            waitForPrompt(h, "/");
            assertEquals(-1, h.rowOf("/ $ /wait.js"), "console 2 has its own screen\n" + h.dump());
            h.enter("echo on two");
            h.waitForText("on two");
            h.terminate(); // the terminate button on console 2: its shell lives on, the program on console 1 too
            h.ticks(5);
            waitForPrompt(h, "/");

            h.alt('1');
            h.waitForText("slept");
            assertEquals(-1, h.rowOf("Terminated"), "terminating console 2 did not reach console 1\n" + h.dump());
            assertEquals(-1, h.rowOf("on two"), h.dump());

            // `exit` on console 2: back on console 1, and console 2 starts afresh when shown again.
            h.alt('2');
            waitForPrompt(h, "/");
            h.enter("exit");
            h.waitForText("slept");
            assertEquals(-1, h.rowOf("on two"), "console 1 is visible again\n" + h.dump());
            h.alt('2');
            waitForPrompt(h, "/");
            assertEquals(-1, h.rowOf("on two"), "console 2 was cleared\n" + h.dump());
            assertEquals(-1, h.rowOf("exit"), h.dump());
        }
    }
}
