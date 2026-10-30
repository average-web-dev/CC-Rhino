// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.junit.jupiter.api.Test;

import static dan200.computercraft.core.tty.InputEncoder.*;
import static dan200.computercraft.core.tty.TerminalEmulator.MouseMode;
import static org.junit.jupiter.api.Assertions.*;

class InputEncoderTest {
    private final InputEncoder encoder = new InputEncoder();

    @Test
    void special_keys() {
        assertEquals("\r", encoder.keyDown(KEY_ENTER));
        assertEquals("\t", encoder.keyDown(KEY_TAB));
        assertEquals("\u007f", encoder.keyDown(KEY_BACKSPACE));
        assertEquals("\u001b[A", encoder.keyDown(KEY_UP));
        assertEquals("\u001b[H", encoder.keyDown(KEY_HOME));
        assertEquals("\u001b[3~", encoder.keyDown(KEY_DELETE));
        assertEquals("\u001bOP", encoder.keyDown(KEY_F1));
        assertEquals("\u001b[24~", encoder.keyDown(KEY_F12));
        assertNull(encoder.keyDown(KEY_A), "printable keys arrive as characters");
    }

    @Test
    void modifiers() {
        assertNull(encoder.keyDown(KEY_LEFT_CONTROL));
        assertEquals("\u001b[1;5C", encoder.keyDown(KEY_RIGHT));
        assertEquals("\u001b[3;5~", encoder.keyDown(KEY_DELETE));
        assertEquals("\u0003", encoder.keyDown(KEY_A + 2), "Ctrl+C");
        assertNull(encoder.charTyped('c'), "no character while Ctrl is held");
        encoder.keyUp(KEY_LEFT_CONTROL);

        encoder.keyDown(KEY_LEFT_SHIFT);
        assertEquals("\u001b[Z", encoder.keyDown(KEY_TAB));
        encoder.keyUp(KEY_LEFT_SHIFT);

        encoder.keyDown(KEY_LEFT_ALT);
        assertEquals("\u001bx", encoder.charTyped('x'));
        assertEquals("\u001b\r", encoder.keyDown(KEY_ENTER));
        encoder.keyUp(KEY_LEFT_ALT);
        assertEquals("x", encoder.charTyped('x'));
    }

    @Test
    void mouse_only_when_requested() {
        assertNull(encoder.mouse(Mouse.PRESS, 1, 1, 1, MouseMode.NONE, true));
        assertNull(encoder.mouse(Mouse.DRAG, 1, 1, 1, MouseMode.CLICKS, true));
    }

    @Test
    void sgr_mouse() {
        assertEquals("\u001b[<0;3;4M", encoder.mouse(Mouse.PRESS, 1, 3, 4, MouseMode.CLICKS, true));
        assertEquals("\u001b[<2;3;4m", encoder.mouse(Mouse.RELEASE, 2, 3, 4, MouseMode.CLICKS, true));
        assertEquals("\u001b[<33;5;6M", encoder.mouse(Mouse.DRAG, 3, 5, 6, MouseMode.DRAG, true));
        assertEquals("\u001b[<64;1;1M", encoder.mouse(Mouse.SCROLL, -1, 1, 1, MouseMode.CLICKS, true));
        assertEquals("\u001b[<65;1;1M", encoder.mouse(Mouse.SCROLL, 1, 1, 1, MouseMode.CLICKS, true));
    }

    @Test
    void x10_mouse() {
        assertEquals("\u001b[M" + (char) 32 + (char) 35 + (char) 36, encoder.mouse(Mouse.PRESS, 1, 3, 4, MouseMode.CLICKS, false));
        assertEquals("\u001b[M" + (char) 35 + (char) 35 + (char) 36, encoder.mouse(Mouse.RELEASE, 1, 3, 4, MouseMode.CLICKS, false));
    }
}
