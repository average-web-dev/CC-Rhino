// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.jspecify.annotations.Nullable;

import static dan200.computercraft.core.tty.GlfwKeys.*;

/**
 * Turns the keyboard and mouse input of a computer (GLFW key codes, typed characters, mouse events) into the bytes a
 * terminal would send, the input of a {@link Tty}.
 * <ul>
 *   <li>Typed characters are sent as they are; with Alt held, prefixed by ESC. While Ctrl is held, characters are not
 *   sent: the key itself becomes a control character.</li>
 *   <li>Enter {@code \r}, Tab {@code \t} (Shift+Tab {@code ESC [ Z}), Backspace {@code \x7f}, Escape {@code ESC};
 *   cursor, Home/End and editing keys as xterm sequences ({@code ESC [ A}, {@code ESC [ 3 ~}, …, with a modifier
 *   parameter when Shift/Alt/Ctrl are held); F1–F12; Ctrl+A … Ctrl+Z as {@code \x01} … {@code \x1a}.</li>
 *   <li>Once a program asks for it ({@code CSI > flags u}, see {@link TerminalEmulator#keyboardFlags()}), keys follow
 *   the <a href="https://sw.kovidgoyal.net/kitty/keyboard-protocol/">kitty keyboard protocol</a>: {@code CSI code ;
 *   modifiers : event ; text u} (and the xterm forms with an event type for cursor and function keys), so programs
 *   also see repeats, releases, the keypad and each modifier key (left and right) — see the flag constants.</li>
 *   <li>Mouse events, only if the program asked for them (see {@link TerminalEmulator#mouseMode()}), as X10 ({@code ESC
 *   [ M b x y}) or SGR ({@code ESC [ < b ; x ; y M/m}) reports.</li>
 * </ul>
 * Not thread-safe; used from the thread that delivers input.
 */
public final class InputEncoder {
    private static final String ESC = "\u001b";
    private static final String CSI = ESC + "[";

    /** Kitty keyboard flag: escape codes for keys that are ambiguous otherwise (Esc, Alt/Ctrl+key, the keypad). */
    public static final int DISAMBIGUATE = 1;
    /** Kitty keyboard flag: report repeats and releases. */
    public static final int REPORT_EVENT_TYPES = 2;
    /** Kitty keyboard flag: report the shifted key too (for text keys whose character is reported). */
    public static final int REPORT_ALTERNATE_KEYS = 4;
    /** Kitty keyboard flag: every key as an escape code, also text keys, Enter, Tab, Backspace and modifier keys. */
    public static final int REPORT_ALL_KEYS = 8;
    /** Kitty keyboard flag: with {@link #REPORT_ALL_KEYS}, the text a key produces as part of its escape code. */
    public static final int REPORT_TEXT = 16;
    /** All kitty keyboard flags. */
    public static final int ALL_FLAGS = 31;

    private static final int PRESS = 1, REPEAT = 2, RELEASE = 3;

    private static final String[] FUNCTION_KEYS = {
        "OP", "OQ", "OR", "OS", "[15~", "[17~", "[18~", "[19~", "[20~", "[21~", "[23~", "[24~",
    };

    /** F1–F12 in the kitty protocol: the number and final character of {@code CSI number ; modifiers final}. */
    private static final int[] FUNCTION_NUMBERS = { 1, 1, 13, 1, 15, 17, 18, 19, 20, 21, 23, 24 };
    private static final char[] FUNCTION_FINALS = { 'P', 'Q', '~', 'S', '~', '~', '~', '~', '~', '~', '~', '~' };

    /** The kind of a mouse event. */
    public enum Mouse {
        PRESS, RELEASE, DRAG, SCROLL,
    }

    private boolean shift;
    private boolean ctrlDown;
    private boolean altDown;
    private boolean superKey;
    /**
     * The right Alt key: AltGr on most non-US layouts (X11's ISO_Level3_Shift arrives as it; Windows adds a left Ctrl).
     * Like a terminal, it selects a key's third character rather than being a modifier: while it is held, Ctrl and Alt
     * do not count, so AltGr+7 types `{` instead of reporting Ctrl+Alt+7.
     */
    private boolean altGr;

    /**
     * A text key whose press waits for its character ({@link #REPORT_TEXT}): the client sends the key and the character
     * it typed separately, the report carries both.
     */
    private int pendingCode = -1;
    private int pendingModifiers;
    private int pendingEvent;
    private int pendingFlags;
    /** The last key was reported as an escape code, so the character it typed is not sent again. */
    private boolean swallowChar;

    public boolean isCtrl() {
        return ctrl();
    }

    public boolean isAlt() {
        return alt();
    }

    /** Ctrl as a modifier: not the one Windows adds to AltGr. */
    private boolean ctrl() {
        return ctrlDown && !altGr;
    }

    /** Alt as a modifier: the left Alt key (the right one is AltGr). */
    private boolean alt() {
        return altDown && !altGr;
    }

    public boolean isShift() {
        return shift;
    }

    /** A key was pressed, with the legacy encoding. */
    public @Nullable String keyDown(int key) {
        return keyDown(key, false, 0);
    }

    /**
     * A key was pressed (or repeats).
     *
     * @param key    The GLFW key code.
     * @param repeat Whether the key is held and repeats.
     * @param flags  The kitty keyboard flags the program asked for (0 for the legacy encoding).
     * @return What the terminal sends, or {@code null} if the key sends nothing (modifiers, printable keys, which
     * arrive as typed characters).
     */
    public @Nullable String keyDown(int key, boolean repeat, int flags) {
        var pending = flush();
        swallowChar = false;
        trackModifier(key, true);
        return join(pending, flags == 0 ? legacyKey(key) : kittyKey(key, repeat ? REPEAT : PRESS, flags));
    }

    /** A key was released, with the legacy encoding (which reports nothing). */
    public void keyUp(int key) {
        keyUp(key, 0);
    }

    /**
     * A key was released.
     *
     * @param key   The GLFW key code.
     * @param flags The kitty keyboard flags the program asked for (0 for the legacy encoding).
     * @return What the terminal sends: a release event, if the program asked for them.
     */
    public @Nullable String keyUp(int key, int flags) {
        var pending = flush();
        swallowChar = false;
        // A release reports the modifiers as they were while the key was down (for a modifier key: including itself).
        var report = flags == 0 ? null : kittyKey(key, RELEASE, flags);
        trackModifier(key, false);
        return join(pending, report);
    }

    /** A character was typed, with the legacy encoding. */
    public @Nullable String charTyped(char ch) {
        return charTyped(ch, 0);
    }

    /**
     * A character was typed.
     *
     * @param ch    The character.
     * @param flags The kitty keyboard flags the program asked for (0 for the legacy encoding).
     * @return What the terminal sends, or {@code null} while Ctrl is held or if the key was reported already.
     */
    public @Nullable String charTyped(char ch, int flags) {
        if (pendingCode >= 0) {
            var alternate = (pendingFlags & REPORT_ALTERNATE_KEYS) != 0 && shift && ch != pendingCode
                ? String.valueOf((int) ch) : null;
            var report = csiU(pendingCode, alternate, pendingModifiers, pendingEvent, ch);
            pendingCode = -1;
            swallowChar = true;
            return report;
        }
        if (swallowChar) {
            swallowChar = false;
            return null;
        }
        if (ctrl()) return null;
        return prefix() + ch;
    }

    /**
     * Pasted text, as a terminal sends it: line endings as {@code \r} (what Enter sends) and, if the program asked for
     * bracketed paste, wrapped in {@code ESC [ 200 ~} … {@code ESC [ 201 ~} (without any ESC of its own, so the text
     * cannot end the bracket early).
     *
     * @param text      The pasted text.
     * @param bracketed Whether the program asked for bracketed paste.
     * @return What the terminal sends.
     */
    public @Nullable String paste(String text, boolean bracketed) {
        var body = text.replace("\r\n", "\r").replace('\n', '\r');
        if (bracketed) body = ESC + "[200~" + body.replace(ESC, "") + ESC + "[201~";
        return join(flush(), body);
    }

    /**
     * A mouse event on the terminal.
     *
     * @param kind   What happened.
     * @param button The button (1 = left, 2 = right, 3 = middle), or for {@link Mouse#SCROLL} the direction (-1 = up,
     *               1 = down).
     * @param x      The column, starting at 1.
     * @param y      The row, starting at 1.
     * @param mode   The mouse events the program asked for.
     * @param sgr    Whether to use the SGR encoding.
     * @return The report, or {@code null} if the program did not ask for this kind of event.
     */
    public @Nullable String mouse(Mouse kind, int button, int x, int y, TerminalEmulator.MouseMode mode, boolean sgr) {
        return join(flush(), mouseReport(kind, button, x, y, mode, sgr));
    }

    private @Nullable String mouseReport(
        Mouse kind, int button, int x, int y, TerminalEmulator.MouseMode mode, boolean sgr
    ) {
        if (mode == TerminalEmulator.MouseMode.NONE) return null;
        if (kind == Mouse.DRAG && mode == TerminalEmulator.MouseMode.CLICKS) return null;

        int code;
        if (kind == Mouse.SCROLL) {
            code = button < 0 ? 64 : 65;
        } else {
            code = switch (button) {
                case 2 -> 2;
                case 3 -> 1;
                default -> 0;
            };
            if (kind == Mouse.DRAG) code += 32;
        }
        if (shift) code += 4;
        if (alt()) code += 8;
        if (ctrl()) code += 16;

        if (sgr) return ESC + "[<" + code + ";" + x + ";" + y + (kind == Mouse.RELEASE ? "m" : "M");

        // X10: releases do not say which button; coordinates are limited to 223.
        if (kind == Mouse.RELEASE) code = 3 + (code & ~3);
        if (x > 223 || y > 223) return null;
        return ESC + "[M" + (char) (32 + code) + (char) (32 + x) + (char) (32 + y);
    }

    // ── Legacy encoding ──────────────────────────────────────────────────────────

    private @Nullable String legacyKey(int key) {
        if (isModifierKey(key)) return null;

        switch (key) {
            case KEY_ENTER, KEY_KP_ENTER -> {
                return prefix() + "\r";
            }
            case KEY_TAB -> {
                return shift ? ESC + "[Z" : prefix() + "\t";
            }
            case KEY_BACKSPACE -> {
                return prefix() + "\u007f";
            }
            case KEY_ESCAPE -> {
                return prefix() + ESC;
            }
            case KEY_INSERT -> {
                return tilde(2);
            }
            case KEY_DELETE -> {
                return tilde(3);
            }
            case KEY_PAGE_UP -> {
                return tilde(5);
            }
            case KEY_PAGE_DOWN -> {
                return tilde(6);
            }
            case KEY_UP -> {
                return cursor('A');
            }
            case KEY_DOWN -> {
                return cursor('B');
            }
            case KEY_RIGHT -> {
                return cursor('C');
            }
            case KEY_LEFT -> {
                return cursor('D');
            }
            case KEY_HOME -> {
                return cursor('H');
            }
            case KEY_END -> {
                return cursor('F');
            }
            default -> {
            }
        }

        if (key >= KEY_F1 && key <= KEY_F12) return ESC + FUNCTION_KEYS[key - KEY_F1];
        // Ctrl+letter: the control character (the computer sends no char event for it).
        if (ctrl() && key >= KEY_A && key <= KEY_Z) return prefix() + (char) (key - KEY_A + 1);
        return null;
    }

    private String prefix() {
        return alt() ? ESC : "";
    }

    /** xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
    private int modifiers() {
        return 1 + (shift ? 1 : 0) + (alt() ? 2 : 0) + (ctrl() ? 4 : 0);
    }

    /** {@code ESC [ n ~}, or {@code ESC [ n ; m ~} with modifiers. */
    private String tilde(int n) {
        var mods = modifiers();
        return ESC + "[" + n + (mods > 1 ? ";" + mods : "") + "~";
    }

    /** {@code ESC [ X}, or {@code ESC [ 1 ; m X} with modifiers. */
    private String cursor(char finalChar) {
        var mods = modifiers();
        return ESC + "[" + (mods > 1 ? "1;" + mods : "") + finalChar;
    }

    // ── Kitty keyboard protocol ──────────────────────────────────────────────────

    private @Nullable String kittyKey(int key, int event, int flags) {
        var all = (flags & REPORT_ALL_KEYS) != 0;
        var disambiguate = all || (flags & DISAMBIGUATE) != 0;
        if (event != PRESS && (flags & REPORT_EVENT_TYPES) == 0) {
            // Without event types, a repeat looks like a press and a release sends nothing.
            if (event == RELEASE) return null;
            event = PRESS;
        }
        var mods = kittyModifiers();

        if (isModifierKey(key)) return all ? csiU(kittyCode(key), null, mods, event, null) : null;

        var text = textCode(key);
        if (text >= 0) {
            var modified = ctrl() || alt() || superKey;
            if (all) {
                if (event != RELEASE && (flags & REPORT_TEXT) != 0 && !modified) {
                    // Wait for the character the key types (charTyped), to report it with the key.
                    pendingCode = text;
                    pendingModifiers = mods;
                    pendingEvent = event;
                    pendingFlags = flags;
                    return null;
                }
                if (event != RELEASE) swallowChar = true;
                return csiU(text, null, mods, event, null);
            }
            if (event == RELEASE) return null;
            if (disambiguate && modified) {
                swallowChar = true;
                return csiU(text, null, mods, event, null);
            }
            return legacyKey(key);
        }

        switch (key) {
            case KEY_ENTER, KEY_TAB, KEY_BACKSPACE -> {
                // Kept as in the legacy encoding unless every key is reported (or, disambiguated, with modifiers).
                if (all || (disambiguate && mods > 1)) return csiU(kittyCode(key), null, mods, event, null);
                return event == RELEASE ? null : legacyKey(key);
            }
            case KEY_ESCAPE -> {
                if (disambiguate) return csiU(27, null, mods, event, null);
                return event == RELEASE ? null : legacyKey(key);
            }
            case KEY_INSERT -> {
                return csi(2, '~', mods, event);
            }
            case KEY_DELETE -> {
                return csi(3, '~', mods, event);
            }
            case KEY_PAGE_UP -> {
                return csi(5, '~', mods, event);
            }
            case KEY_PAGE_DOWN -> {
                return csi(6, '~', mods, event);
            }
            case KEY_UP -> {
                return csi(1, 'A', mods, event);
            }
            case KEY_DOWN -> {
                return csi(1, 'B', mods, event);
            }
            case KEY_RIGHT -> {
                return csi(1, 'C', mods, event);
            }
            case KEY_LEFT -> {
                return csi(1, 'D', mods, event);
            }
            case KEY_HOME -> {
                return csi(1, 'H', mods, event);
            }
            case KEY_END -> {
                return csi(1, 'F', mods, event);
            }
            default -> {
            }
        }

        if (key >= KEY_F1 && key <= KEY_F12) {
            return csi(FUNCTION_NUMBERS[key - KEY_F1], FUNCTION_FINALS[key - KEY_F1], mods, event);
        }

        var code = kittyCode(key);
        if (code < 0) return null;
        if (key >= KEY_KP_0 && key <= KEY_KP_EQUAL) {
            if (!disambiguate) return event == RELEASE ? null : legacyKey(key);
            // The keypad's digits and operators also type a character, which the report replaces.
            if (event != RELEASE) swallowChar = true;
        } else if (!disambiguate) {
            return null;
        }
        return csiU(code, null, mods, event, null);
    }

    /** The kitty modifier parameter: 1 + shift(1) + alt(2) + ctrl(4) + super(8). */
    private int kittyModifiers() {
        return 1 + (shift ? 1 : 0) + (alt() ? 2 : 0) + (ctrl() ? 4 : 0) + (superKey ? 8 : 0);
    }

    /** {@code CSI code [: alternate] [; modifiers [: event]] [; text] u}. */
    private static String csiU(int code, @Nullable String alternate, int mods, int event, @Nullable Character text) {
        var out = new StringBuilder(CSI).append(code);
        if (alternate != null) out.append(':').append(alternate);
        if (mods > 1 || event != PRESS || text != null) {
            out.append(';').append(mods);
            if (event != PRESS) out.append(':').append(event);
        }
        if (text != null) out.append(';').append((int) text);
        return out.append('u').toString();
    }

    /** {@code CSI number final} (or {@code CSI final} for number 1), with {@code ; modifiers : event} when needed. */
    private static String csi(int number, char finalChar, int mods, int event) {
        if (mods == 1 && event == PRESS) return finalChar == '~' ? CSI + number + "~" : CSI + finalChar;
        return CSI + number + ";" + mods + (event != PRESS ? ":" + event : "") + finalChar;
    }

    /** The key's character on a US keyboard (letters in lower case), or -1 if it is no text key. */
    private static int textCode(int key) {
        if (key >= KEY_A && key <= KEY_Z) return key + ('a' - 'A');
        if (key == KEY_SPACE || key == KEY_APOSTROPHE || (key >= KEY_COMMA && key <= KEY_9) || key == KEY_SEMICOLON
            || key == KEY_EQUAL || (key >= KEY_LEFT_BRACKET && key <= KEY_RIGHT_BRACKET) || key == KEY_GRAVE_ACCENT) {
            return key;
        }
        return -1;
    }

    /** The kitty protocol's number for a key without a character, or -1. */
    private static int kittyCode(int key) {
        if (key >= KEY_KP_0 && key <= KEY_KP_EQUAL) return 57399 + key - KEY_KP_0;
        if (key >= KEY_F13 && key <= KEY_F25) return 57376 + key - KEY_F13;
        return switch (key) {
            case KEY_ESCAPE -> 27;
            case KEY_ENTER -> 13;
            case KEY_TAB -> 9;
            case KEY_BACKSPACE -> 127;
            case KEY_CAPS_LOCK -> 57358;
            case KEY_SCROLL_LOCK -> 57359;
            case KEY_NUM_LOCK -> 57360;
            case KEY_PRINT_SCREEN -> 57361;
            case KEY_PAUSE -> 57362;
            case KEY_MENU -> 57363;
            case KEY_LEFT_SHIFT -> 57441;
            case KEY_LEFT_CONTROL -> 57442;
            case KEY_LEFT_ALT -> 57443;
            case KEY_LEFT_SUPER -> 57444;
            case KEY_RIGHT_SHIFT -> 57447;
            case KEY_RIGHT_CONTROL -> 57448;
            case KEY_RIGHT_ALT -> 57449;
            case KEY_RIGHT_SUPER -> 57450;
            default -> -1;
        };
    }

    // ── State ────────────────────────────────────────────────────────────────────

    private static boolean isModifierKey(int key) {
        return key >= KEY_LEFT_SHIFT && key <= KEY_RIGHT_SUPER;
    }

    private void trackModifier(int key, boolean down) {
        switch (key) {
            case KEY_LEFT_SHIFT, KEY_RIGHT_SHIFT -> shift = down;
            case KEY_LEFT_CONTROL, KEY_RIGHT_CONTROL -> ctrlDown = down;
            case KEY_LEFT_ALT -> altDown = down;
            case KEY_RIGHT_ALT -> altGr = down;
            case KEY_LEFT_SUPER, KEY_RIGHT_SUPER -> superKey = down;
            default -> {
            }
        }
    }

    /** A text key press still waiting for its character, reported without it. */
    private @Nullable String flush() {
        if (pendingCode < 0) return null;
        var report = csiU(pendingCode, null, pendingModifiers, pendingEvent, null);
        pendingCode = -1;
        return report;
    }

    private static @Nullable String join(@Nullable String first, @Nullable String second) {
        if (first == null) return second;
        return second == null ? first : first + second;
    }
}
