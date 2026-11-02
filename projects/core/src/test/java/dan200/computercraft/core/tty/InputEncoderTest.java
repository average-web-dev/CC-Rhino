// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.junit.jupiter.api.Test;

import static dan200.computercraft.core.tty.GlfwKeys.*;
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

    /** AltGr (the right Alt key; Windows adds a left Ctrl) types a key's third character, it is no modifier. */
    @Test
    void alt_gr_types_characters() {
        encoder.keyDown(KEY_RIGHT_ALT);
        assertNull(encoder.keyDown(KEY_0 + 7));
        assertEquals("{", encoder.charTyped('{'), "legacy: not Alt+{");
        encoder.keyUp(KEY_0 + 7);
        assertFalse(encoder.isAlt());

        // Windows: Ctrl+AltGr.
        encoder.keyDown(KEY_LEFT_CONTROL);
        assertNull(encoder.keyDown(KEY_A + 16));
        assertEquals("@", encoder.charTyped('@'), "not swallowed as a Ctrl character");
        encoder.keyUp(KEY_A + 16);
        encoder.keyUp(KEY_LEFT_CONTROL);

        // Kitty, every key reported with its text: the key with the character it typed, without modifiers.
        assertNull(encoder.keyDown(KEY_0 + 8, false, FULL));
        assertEquals("\u001b[56;1;91u", encoder.charTyped('[', FULL));
        // Only disambiguated: the character as typed.
        assertNull(encoder.keyDown(KEY_0, false, DISAMBIGUATE));
        assertEquals("}", encoder.charTyped('}', DISAMBIGUATE));
        encoder.keyUp(KEY_RIGHT_ALT);

        // The left Alt is still Alt.
        encoder.keyDown(KEY_LEFT_ALT);
        assertEquals("\u001bb", encoder.charTyped('b'));
        encoder.keyUp(KEY_LEFT_ALT);
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

    // ── Kitty keyboard protocol ──────────────────────────────────────────────────

    private static final int FULL = DISAMBIGUATE | REPORT_EVENT_TYPES | REPORT_ALL_KEYS | REPORT_TEXT;

    @Test
    void kitty_disambiguate() {
        assertEquals("\u001b[27u", encoder.keyDown(KEY_ESCAPE, false, DISAMBIGUATE));
        assertEquals("\r", encoder.keyDown(KEY_ENTER, false, DISAMBIGUATE), "Enter stays as it is");
        assertNull(encoder.keyDown(KEY_A, false, DISAMBIGUATE), "plain text keys type their character");
        assertEquals("a", encoder.charTyped('a', DISAMBIGUATE));
        assertNull(encoder.keyUp(KEY_A, DISAMBIGUATE), "no releases without event types");

        encoder.keyDown(KEY_LEFT_CONTROL, false, DISAMBIGUATE);
        assertEquals("\u001b[99;5u", encoder.keyDown(KEY_A + 2, false, DISAMBIGUATE), "Ctrl+C");
        assertEquals("\u001b[13;5u", encoder.keyDown(KEY_ENTER, false, DISAMBIGUATE), "Ctrl+Enter");
        encoder.keyUp(KEY_LEFT_CONTROL, DISAMBIGUATE);

        encoder.keyDown(KEY_LEFT_ALT, false, DISAMBIGUATE);
        assertEquals("\u001b[120;3u", encoder.keyDown(KEY_A + 23, false, DISAMBIGUATE), "Alt+X");
        assertNull(encoder.charTyped('x', DISAMBIGUATE), "the character is part of the report");
        encoder.keyUp(KEY_LEFT_ALT, DISAMBIGUATE);

        assertEquals("\u001b[57399u", encoder.keyDown(KEY_KP_0, false, DISAMBIGUATE), "keypad 0");
        assertNull(encoder.charTyped('0', DISAMBIGUATE));
        assertEquals("\u001b[57414u", encoder.keyDown(KEY_KP_ENTER, false, DISAMBIGUATE));
        assertEquals("\u001b[A", encoder.keyDown(KEY_UP, false, DISAMBIGUATE));
        assertEquals("\u001b[P", encoder.keyDown(KEY_F1, false, DISAMBIGUATE));
        assertEquals("\u001b[13~", encoder.keyDown(KEY_F1 + 2, false, DISAMBIGUATE), "F3");
        assertNull(encoder.keyDown(KEY_LEFT_SHIFT, false, DISAMBIGUATE), "modifier keys need REPORT_ALL_KEYS");
    }

    @Test
    void kitty_event_types() {
        var flags = DISAMBIGUATE | REPORT_EVENT_TYPES;
        assertEquals("\u001b[A", encoder.keyDown(KEY_UP, false, flags));
        assertEquals("\u001b[1;1:2A", encoder.keyDown(KEY_UP, true, flags), "repeat");
        assertEquals("\u001b[1;1:3A", encoder.keyUp(KEY_UP, flags), "release");
        assertEquals("\u001b[27;1:3u", encoder.keyUp(KEY_ESCAPE, flags));
        assertNull(encoder.keyUp(KEY_A, flags), "text keys are only released with REPORT_ALL_KEYS");
        assertNull(encoder.keyUp(KEY_ENTER, flags));
        assertEquals("\u001b[A", encoder.keyDown(KEY_UP, true, DISAMBIGUATE), "without event types a repeat is a press");
    }

    @Test
    void kitty_all_keys_with_text() {
        assertNull(encoder.keyDown(KEY_A, false, FULL), "waits for the character");
        assertEquals("\u001b[97;1;97u", encoder.charTyped('a', FULL));
        assertEquals("\u001b[97;1:3u", encoder.keyUp(KEY_A, FULL));

        assertEquals("\u001b[57441;2u", encoder.keyDown(KEY_LEFT_SHIFT, false, FULL), "left shift");
        assertNull(encoder.keyDown(KEY_A, false, FULL));
        assertEquals("\u001b[97;2;65u", encoder.charTyped('A', FULL), "the key is 'a', the text 'A'");
        assertEquals("\u001b[97;2:2;65u", join(encoder.keyDown(KEY_A, true, FULL), encoder.charTyped('A', FULL)),
            "repeat");
        assertEquals("\u001b[97;2:3u", encoder.keyUp(KEY_A, FULL));
        assertEquals("\u001b[57441;2:3u", encoder.keyUp(KEY_LEFT_SHIFT, FULL));
        assertEquals("\u001b[57447;2u", encoder.keyDown(KEY_RIGHT_SHIFT, false, FULL), "right shift");
        encoder.keyUp(KEY_RIGHT_SHIFT, FULL);

        assertEquals("\u001b[13u", encoder.keyDown(KEY_ENTER, false, FULL));
        assertEquals("\u001b[13;1:3u", encoder.keyUp(KEY_ENTER, FULL));
        assertEquals("\u001b[127u", encoder.keyDown(KEY_BACKSPACE, false, FULL));

        // A key whose character never comes (a dead key) is reported without text by the next key event.
        assertNull(encoder.keyDown(KEY_GRAVE_ACCENT, false, FULL));
        assertEquals("\u001b[96u\u001b[96;1:3u", encoder.keyUp(KEY_GRAVE_ACCENT, FULL));
    }

    @Test
    void kitty_alternate_keys() {
        var flags = FULL | REPORT_ALTERNATE_KEYS;
        encoder.keyDown(KEY_LEFT_SHIFT, false, flags);
        encoder.keyDown(KEY_1, false, flags);
        assertEquals("\u001b[49:33;2;33u", encoder.charTyped('!', flags), "Shift+1 types '!'");
    }

    @Test
    void kitty_flags_need_a_program() {
        assertNull(encoder.keyUp(KEY_UP, 0), "the legacy encoding reports no releases");
        assertEquals("\u001b", encoder.keyDown(KEY_ESCAPE, false, 0));
    }

    @Test
    void paste_as_typed_or_bracketed() {
        assertEquals("a\rb\rc", encoder.paste("a\r\nb\nc", false), "line endings as Enter sends them");
        assertEquals("\u001b[200~a\rb\u001b[201~", encoder.paste("a\nb", true));
        assertEquals("\u001b[200~x[201~y\u001b[201~", encoder.paste("x\u001b[201~y", true),
            "the text cannot end the bracket early");
    }

    private static String join(String a, String b) {
        return (a == null ? "" : a) + (b == null ? "" : b);
    }
}
