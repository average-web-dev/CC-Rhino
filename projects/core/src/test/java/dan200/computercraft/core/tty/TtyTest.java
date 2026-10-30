// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class TtyTest {
    private static String readAll(Pipe pipe) {
        var read = pipe.read();
        assertFalse(read.isEof(), "unexpected end of input");
        return read.data();
    }

    @Test
    void pipe_buffers_writes_until_read() {
        var pipe = new Pipe();
        pipe.write("ab");
        pipe.write("c");
        assertEquals(3, pipe.buffered());
        assertEquals("abc", readAll(pipe));
        assertTrue(pipe.read().isEmpty());
        assertEquals(0, pipe.buffered());
    }

    @Test
    void pipe_eof_mark_is_read_once() {
        var pipe = new Pipe();
        pipe.write("x");
        pipe.writeEof();
        pipe.write("y");
        assertEquals("x", readAll(pipe));
        assertTrue(pipe.read().isEof());
        assertEquals("y", readAll(pipe));
        assertTrue(pipe.read().isEmpty());
    }

    @Test
    void ended_pipe_drains_then_reports_end() {
        var pipe = new Pipe();
        pipe.write("x");
        pipe.end();
        pipe.write("dropped");
        assertEquals("x", readAll(pipe));
        assertTrue(pipe.read().isEof());
        assertTrue(pipe.read().isEof());
    }

    @Test
    void sink_receives_writes_instead_of_the_buffer() {
        var pipe = new Pipe();
        var seen = new StringBuilder();
        pipe.setSink(seen::append);
        pipe.write("hi");
        assertEquals("hi", seen.toString());
        assertTrue(pipe.read().isEmpty());
    }

    @Test
    void waiters_are_notified_once() {
        var pipe = new Pipe();
        var calls = new AtomicInteger();
        assertTrue(pipe.await(calls::incrementAndGet));
        assertTrue(pipe.await(calls::incrementAndGet));
        pipe.write("a");
        assertEquals(2, calls.get());
        pipe.write("b");
        assertEquals(2, calls.get(), "waiters are removed once notified");
        assertFalse(pipe.await(calls::incrementAndGet), "a readable pipe does not register waiters");
    }

    @Test
    void flow_pushes_buffered_and_later_data() {
        var pipe = new Pipe();
        var pushed = new ArrayList<Pipe.Read>();
        pipe.write("a");
        pipe.setFlow(pushed::add);
        assertTrue(pipe.isFlowing());
        pipe.write("b");
        pipe.writeEof();
        assertEquals(3, pushed.size());
        assertEquals("a", pushed.get(0).data());
        assertEquals("b", pushed.get(1).data());
        assertTrue(pushed.get(2).isEof());

        pipe.setFlow(null);
        pipe.write("kept");
        assertEquals(3, pushed.size(), "a paused pipe buffers");
        assertEquals("kept", readAll(pipe));
    }

    @Test
    void flow_pushes_the_end_once() {
        var pipe = new Pipe();
        var pushed = new ArrayList<Pipe.Read>();
        pipe.setFlow(pushed::add);
        pipe.write("x");
        pipe.end();
        assertEquals(2, pushed.size());
        assertTrue(pushed.get(1).isEof());
        assertFalse(pipe.isFlowing(), "the flow stops after the end");
    }

    @Test
    void ids_are_unique() {
        assertNotEquals(new Pipe().id(), new Pipe().id());
        assertNotEquals(new Tty(1, 1).id(), new Tty(1, 1).id());
    }

    @Test
    void cooked_mode_delivers_lines_and_echoes() {
        var tty = new Tty(51, 19);
        tty.input("hel");
        assertTrue(tty.stdin().read().isEmpty(), "no line yet");
        tty.input("lo\r");
        assertEquals("hello\n", readAll(tty.stdin()));
        assertEquals("hello\n", readAll(tty.stdout()));
    }

    @Test
    void cooked_mode_crlf_is_one_line() {
        var tty = new Tty(51, 19);
        tty.input("a\r\nb\n");
        assertEquals("a\nb\n", readAll(tty.stdin()));
    }

    @Test
    void cooked_mode_editing() {
        var tty = new Tty(51, 19);
        tty.input("abc\u007f\u007fd\r");
        assertEquals("ad\n", readAll(tty.stdin()));
        assertEquals("abc\b \b\b \bd\n", readAll(tty.stdout()));

        tty.input("xyz\u0015q\n");
        assertEquals("q\n", readAll(tty.stdin()));
    }

    @Test
    void cooked_mode_ignores_escape_sequences_and_controls() {
        var tty = new Tty(51, 19);
        tty.input("a\u001b[A\u001b[1;5Cb\u001bOPc\u0007\td\r");
        assertEquals("abc\td\n", readAll(tty.stdin()));
    }

    @Test
    void ctrl_d_ends_input_on_an_empty_line_only() {
        var tty = new Tty(51, 19);
        tty.input("ab\u0004");
        assertEquals("ab", readAll(tty.stdin()));
        tty.input("\u0004");
        assertTrue(tty.stdin().read().isEof());
        tty.input("c\r");
        assertEquals("c\n", readAll(tty.stdin()), "reading continues after end of input");
    }

    @Test
    void ctrl_c_discards_the_line_and_interrupts() {
        var tty = new Tty(51, 19);
        var interrupts = new ArrayList<String>();
        tty.setOnInterrupt(() -> interrupts.add("int"));
        tty.input("abc\u0003d\r");
        assertEquals(1, interrupts.size());
        assertEquals("d\n", readAll(tty.stdin()));
        assertEquals("abc^C\nd\n", readAll(tty.stdout()));
    }

    @Test
    void raw_mode_passes_input_through() {
        var tty = new Tty(51, 19);
        tty.input("ab");
        tty.setRaw(true);
        tty.input("x\u0003\u001b[A\r");
        assertEquals("x\u0003\u001b[A\r", readAll(tty.stdin()));
        assertEquals("ab", readAll(tty.stdout()), "only the cooked input was echoed; raw input is not");
        tty.setRaw(false);
        tty.input("y\r");
        assertEquals("y\n", readAll(tty.stdin()), "the half-typed line was dropped when switching modes");
    }

    @Test
    void attached_device_receives_output_and_echo() {
        var tty = new Tty(51, 19);
        var screen = new StringBuilder();
        tty.attach(screen::append, screen::append);
        tty.stdout().write("$ ");
        tty.stderr().write("!");
        tty.input("ls\r");
        assertEquals("$ !ls\n", screen.toString());
        assertEquals("ls\n", readAll(tty.stdin()));
    }

    @Test
    void resize_notifies() {
        var tty = new Tty(51, 19);
        var calls = new AtomicInteger();
        tty.setOnResize(calls::incrementAndGet);
        tty.resize(51, 19);
        assertEquals(0, calls.get());
        tty.resize(20, 10);
        assertEquals(1, calls.get());
        assertEquals(20, tty.columns());
        assertEquals(10, tty.rows());
        assertThrows(IllegalArgumentException.class, () -> tty.resize(0, 1));
    }
}
