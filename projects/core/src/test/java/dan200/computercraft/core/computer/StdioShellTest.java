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
            h.waitForText("world!");
            assertEquals(1, count(h, "world!"), h.dump());
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

            // Ctrl+T ends it while it waits for input.
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
}
