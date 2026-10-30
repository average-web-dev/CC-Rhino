// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.tty;

import dan200.computercraft.core.computer.ComputerBootstrap;
import org.junit.jupiter.api.Test;

import static java.time.Duration.ofSeconds;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

/**
 * The engine-internal {@code internal/pty} module on a real computer: virtual TTYs, blocking reads woken by another
 * thread, end of input and the promise flavour.
 */
class PtyAPITest {
    private static void run(String program) {
        assertTimeoutPreemptively(ofSeconds(30), () -> ComputerBootstrap.run(program, 20));
    }

    @Test
    void virtual_tty_size_and_buffered_output() {
        run("""
            var pty = require('internal/pty');
            var tty = pty.create(20, 5);
            assert(tty.getSize().columns === 20 && tty.getSize().rows === 5, 'size');
            assert(tty.isResizable(), 'virtual TTYs are resizable');
            tty.setSize(30, 6);
            assert(tty.getSize().columns === 30, 'resized');

            var out = tty.getStdout();
            out.write('hello');
            assert(out.getBuffered() === 5, 'buffered');
            assert(out.tryRead() === 'hello', 'tryRead');
            assert(out.tryRead() === '', 'empty');

            var def = pty.create();
            assert(def.getSize().columns === 51 && def.getSize().rows === 19, 'default size');
            """);
    }

    @Test
    void blocking_read_is_woken_by_another_thread() {
        run("""
            var pty = require('internal/pty');
            var parallel = require('parallel');
            var system = require('system');
            var tty = pty.create();
            var stdin = tty.getStdin();
            var got = null;
            parallel.waitForAll(
                function () { got = stdin.read(); },
                function () { system.sleep(2); stdin.write('li'); system.sleep(1); stdin.write('ne\\r'); }
            );
            assert(got === 'line\\n', 'read ' + JSON.stringify(got));
            assert(tty.getStdout().tryRead() === 'line\\n', 'echoed');
            """);
    }

    @Test
    void raw_mode_and_end_of_input() {
        run("""
            var tty = require('internal/pty').create();
            var stdin = tty.getStdin();
            stdin.write('\\u0004');
            assert(stdin.read() === undefined, 'Ctrl+D on an empty line');
            tty.setRaw(true);
            assert(tty.isRaw(), 'raw');
            stdin.write('\\u001b[A');
            assert(stdin.read() === '\\u001b[A', 'raw input is passed through');

            var out = tty.getStdout();
            out.write('bye');
            out.end();
            assert(out.isEnded(), 'ended');
            assert(out.read() === 'bye', 'buffered data first');
            assert(out.read() === undefined, 'then end of input');
            """);
    }

    @Test
    void promise_read() {
        run("""
            var async = require('async');
            var tty = async.unwrap(require('internal/pty/promises').create());
            var stdin = async.unwrap(tty.getStdin());
            var pending = stdin.read();
            async.unwrap(stdin.write('x\\r'));
            assert(async.unwrap(pending) === 'x\\n', 'promise read');
            """);
    }
}
