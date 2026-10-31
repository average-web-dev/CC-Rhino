// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import dan200.computercraft.core.terminal.Terminal;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static dan200.computercraft.core.tty.InputEncoder.*;
import static org.junit.jupiter.api.Assertions.*;

class ScreenTest {
    private final Terminal display = new Terminal(10, 3, true);
    private final Screen screen = new Screen(display, 3);

    private String line(int y) {
        return display.getLine(y).toString();
    }

    private static String readAll(Pipe pipe) {
        var read = pipe.read();
        assertFalse(read.isEof());
        return read.data();
    }

    @Test
    void inactive_screen_neither_draws_nor_takes_input() {
        display.write("legacy");
        screen.consoles().get(0).tty().stdout().write("x");
        screen.charTyped('a');
        assertEquals("legacy    ", line(0));
        assertTrue(screen.consoles().get(0).tty().stdin().read().isEmpty());
    }

    @Test
    void active_screen_mirrors_the_visible_console() {
        screen.activate();
        assertEquals("          ", line(0), "the display shows the (empty) console");
        screen.consoles().get(0).tty().stdout().write("one");
        screen.consoles().get(1).tty().stdout().write("two");
        assertEquals("one       ", line(0));
        assertEquals(3, display.getCursorX());

        assertTrue(screen.show(1));
        assertEquals("two       ", line(0));
        screen.consoles().get(0).tty().stdout().write("!");
        assertEquals("two       ", line(0), "hidden consoles render off screen");
        assertEquals("one!      ", screen.consoles().get(0).buffer().getLine(0).toString());
        assertFalse(screen.show(5));
    }

    @Test
    void input_goes_to_the_visible_console() {
        screen.activate();
        screen.show(2);
        screen.charTyped('h');
        screen.charTyped('i');
        screen.keyDown(KEY_ENTER);
        assertEquals("hi\n", readAll(screen.consoles().get(2).tty().stdin()));
        assertEquals("hi        ", line(0), "echo is shown");
        assertTrue(screen.consoles().get(0).tty().stdin().read().isEmpty());

        screen.paste("p\n");
        assertEquals("p\n", readAll(screen.consoles().get(2).tty().stdin()));
    }

    @Test
    void ctrl_c_interrupts_the_visible_console() {
        var interrupted = new ArrayList<Integer>();
        screen.setOnInterrupt(interrupted::add);
        screen.activate();
        screen.show(1);
        screen.keyDown(KEY_LEFT_CONTROL);
        screen.keyDown(KEY_A + 2); // Ctrl+C
        screen.keyUp(KEY_A + 2);
        screen.keyUp(KEY_LEFT_CONTROL);
        assertEquals(List.of(screen.consoles().get(1).tty().id()), interrupted);

        // In raw mode it is just a key.
        screen.consoles().get(1).tty().setRaw(true);
        screen.keyDown(KEY_LEFT_CONTROL);
        screen.keyDown(KEY_A + 2);
        screen.keyUp(KEY_LEFT_CONTROL);
        assertEquals(1, interrupted.size());
        assertEquals("\u0003", readAll(screen.consoles().get(1).tty().stdin()));
    }

    @Test
    void alt_digit_switches_consoles() {
        screen.activate();
        screen.keyDown(KEY_LEFT_ALT);
        screen.keyDown(49 + 1); // Alt+2
        screen.charTyped('2');
        screen.keyUp(KEY_LEFT_ALT);
        assertEquals(1, screen.visible().index());
        assertTrue(screen.consoles().get(1).tty().stdin().read().isEmpty(), "the digit is not typed");

        screen.keyDown(KEY_LEFT_ALT);
        screen.keyDown(49 + 8); // Alt+9: no such console
        screen.keyUp(KEY_LEFT_ALT);
        assertEquals(1, screen.visible().index());
    }

    @Test
    void single_console_screen_types_alt_digits() {
        var single = new Screen(new Terminal(10, 3, false), 1);
        single.activate();
        single.consoles().get(0).tty().setRaw(true);
        single.keyDown(KEY_LEFT_ALT);
        single.keyDown(49);
        single.charTyped('1');
        single.keyUp(KEY_LEFT_ALT);
        assertEquals("\u001b1", readAll(single.consoles().get(0).tty().stdin()), "Alt+1 is typed, not a switch");
    }

    @Test
    void mouse_reports_when_requested() {
        screen.activate();
        var console = screen.consoles().get(0);
        console.tty().setRaw(true);
        screen.mouse(Mouse.PRESS, 1, 2, 3);
        assertTrue(console.tty().stdin().read().isEmpty(), "not requested");
        console.tty().stdout().write("\u001b[?1000;1006h");
        screen.mouse(Mouse.PRESS, 1, 2, 3);
        assertEquals("\u001b[<0;2;3M", readAll(console.tty().stdin()));
    }

    @Test
    void reset_recreates_and_deactivates() {
        screen.activate();
        var before = screen.consoles().get(0);
        screen.reset();
        assertFalse(screen.isActive());
        assertNotSame(before, screen.consoles().get(0));
        assertEquals(0, screen.visible().index());
    }
}
