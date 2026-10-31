// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import dan200.computercraft.core.terminal.Terminal;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class TerminalEmulatorTest {
    private final Terminal terminal = new Terminal(10, 3, true);
    private final TerminalEmulator emulator = new TerminalEmulator(terminal);

    private String line(int y) {
        return terminal.getLine(y).toString();
    }

    private String fg(int y) {
        return terminal.getTextColourLine(y).toString();
    }

    private String bg(int y) {
        return terminal.getBackgroundColourLine(y).toString();
    }

    private void assertCursor(int x, int y) {
        assertEquals(x, terminal.getCursorX(), "cursor x");
        assertEquals(y, terminal.getCursorY(), "cursor y");
    }

    @Test
    void text_wraps_with_pending_wrap_and_scrolls() {
        emulator.writeOut("0123456789");
        assertCursor(10, 0); // pending wrap: still on the first row
        emulator.writeOut("ab");
        assertEquals("0123456789", line(0));
        assertEquals("ab        ", line(1));
        emulator.writeOut("\ncd\nef");
        assertEquals("ab        ", line(0), "scrolled");
        assertEquals("cd        ", line(1));
        assertEquals("ef        ", line(2));
        assertCursor(2, 2);
    }

    @Test
    void carriage_return_tab_and_backspace() {
        emulator.writeOut("abc\rX\tY");
        assertEquals("X       Y ", line(0), "a tab writes spaces up to the next stop");
        emulator.writeOut("\b\bZ");
        assertEquals("X      ZY ", line(0));

        emulator.writeOut("\r\n\b");
        assertCursor(9, 0); // backspace at column 0 goes to the end of the previous row
    }

    @Test
    void sgr_colours() {
        emulator.writeOut("\u001b[31ma\u001b[42mb\u001b[0mc\u001b[38;5;12md\u001b[94;105me");
        assertEquals("abcde", line(0).substring(0, 5));
        // a: red on black; b: red on green; c: reset; d: 256-colour 12 (light blue); e: bright blue on bright magenta.
        assertEquals("ee033", fg(0).substring(0, 5));
        assertEquals("fdff2", bg(0).substring(0, 5));
    }

    @Test
    void cc_colour_extension() {
        emulator.writeOut("\u001b[38;6;12;48;6;4ma\u001b[38;6;16mb");
        assertEquals("cc", fg(0).substring(0, 2), "brown, which ANSI cannot name; 16 is ignored");
        assertEquals("44", bg(0).substring(0, 2), "yellow background");
    }

    @Test
    void stderr_is_red_and_restores_the_colour() {
        emulator.writeOut("\u001b[32m");
        emulator.writeErr("e\u001b[0mf");
        emulator.writeOut("g");
        assertEquals("efg", line(0).substring(0, 3));
        assertEquals("eed", fg(0).substring(0, 3), "stderr defaults to red, stdout keeps green");
    }

    @Test
    void cursor_movement() {
        emulator.writeOut("\u001b[2;5HX\u001b[AY\u001b[3DZ\u001b[1GW\u001b[sQ\u001b[3;9Hq\u001b[uR");
        assertEquals("WR Z Y    ", line(0), "Q was overwritten by R at the restored position");
        assertEquals("    X     ", line(1));
        assertEquals("        q ", line(2));
        assertCursor(2, 0);
    }

    @Test
    void erase_line_and_screen() {
        emulator.writeOut("0123456789abcdefghijABCDEFGHIJ");
        emulator.writeOut("\u001b[2;5H\u001b[K");
        assertEquals("abcd      ", line(1));
        emulator.writeOut("\u001b[1K");
        assertEquals("          ", line(1));
        emulator.writeOut("\u001b[1;3H\u001b[1J");
        assertEquals("   3456789", line(0));
        emulator.writeOut("\u001b[2J");
        assertEquals("          ", line(2));
    }

    @Test
    void sequences_split_across_writes() {
        emulator.writeOut("a\u001b");
        emulator.writeOut("[3");
        emulator.writeOut("1mb");
        assertEquals("ab", line(0).substring(0, 2));
        assertEquals("0e", fg(0).substring(0, 2));
    }

    @Test
    void blit_sequence() {
        emulator.writeOut("\u001b[2;2H\u001bPcc-blit;0e1;f0f;a;b\u001b\\c");
        assertEquals(" a;bc     ", line(1));
        assertEquals("0e10", fg(1).substring(1, 5));
        assertEquals("f0ff", bg(1).substring(1, 5));
        assertCursor(5, 1);
    }

    @Test
    void malformed_blit_is_ignored() {
        emulator.writeOut("\u001bPcc-blit;00;f;ab\u001b\\x");
        assertEquals("x         ", line(0));
    }

    @Test
    void private_modes() {
        emulator.writeOut("\u001b[?25h");
        assertTrue(terminal.getCursorBlink());
        emulator.writeOut("\u001b[?25l\u001b[?1002;1006h");
        assertFalse(terminal.getCursorBlink());
        assertEquals(TerminalEmulator.MouseMode.DRAG, emulator.mouseMode());
        assertTrue(emulator.sgrMouse());
        emulator.writeOut("\u001b[?1002l");
        assertEquals(TerminalEmulator.MouseMode.NONE, emulator.mouseMode());
    }

    @Test
    void reset_clears_and_homes() {
        emulator.writeOut("\u001b[?1000habc\u001b[31m\u001bc");
        assertEquals("          ", line(0));
        assertCursor(0, 0);
        assertEquals(TerminalEmulator.MouseMode.NONE, emulator.mouseMode());
        emulator.writeOut("x");
        assertEquals('0', fg(0).charAt(0));
    }

    @Test
    void monochrome_terminal_ignores_colours() {
        var mono = new Terminal(5, 1, false);
        var emu = new TerminalEmulator(mono);
        emu.writeOut("\u001b[31ma");
        emu.writeErr("b");
        assertEquals("00", mono.getTextColourLine(0).toString().substring(0, 2));
    }

    @Test
    void attached_tty_renders_output_and_echo() {
        var tty = new Tty(10, 3);
        emulator.attach(tty);
        tty.stdout().write("$ ");
        tty.input("ls\r");
        assertEquals("$ ls      ", line(0));
        assertCursor(0, 1);
    }
}
