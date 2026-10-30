// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.jspecify.annotations.Nullable;

/**
 * Turns the keyboard and mouse input of a computer (GLFW key codes, typed characters, mouse events) into the bytes a
 * terminal would send, the input of a {@link Tty}.
 * <ul>
 *   <li>Typed characters are sent as they are; with Alt held, prefixed by ESC. While Ctrl is held, characters are not
 *   sent: the key itself becomes a control character.</li>
 *   <li>Enter {@code \r}, Tab {@code \t} (Shift+Tab {@code ESC [ Z}), Backspace {@code \x7f}, Escape {@code ESC};
 *   cursor, Home/End and editing keys as xterm sequences ({@code ESC [ A}, {@code ESC [ 3 ~}, …, with a modifier
 *   parameter when Shift/Alt/Ctrl are held); F1–F12; Ctrl+A … Ctrl+Z as {@code \x01} … {@code \x1a}.</li>
 *   <li>Mouse events, only if the program asked for them (see {@link TerminalEmulator#mouseMode()}), as X10 ({@code ESC
 *   [ M b x y}) or SGR ({@code ESC [ < b ; x ; y M/m}) reports.</li>
 * </ul>
 * Not thread-safe; used from the thread that delivers input.
 */
public final class InputEncoder {
    private static final String ESC = "\u001b";

    static final int KEY_ESCAPE = 256, KEY_ENTER = 257, KEY_TAB = 258, KEY_BACKSPACE = 259, KEY_INSERT = 260,
        KEY_DELETE = 261, KEY_RIGHT = 262, KEY_LEFT = 263, KEY_DOWN = 264, KEY_UP = 265, KEY_PAGE_UP = 266,
        KEY_PAGE_DOWN = 267, KEY_HOME = 268, KEY_END = 269, KEY_F1 = 290, KEY_F12 = 301, KEY_KP_ENTER = 335,
        KEY_LEFT_SHIFT = 340, KEY_LEFT_CONTROL = 341, KEY_LEFT_ALT = 342, KEY_RIGHT_SHIFT = 344,
        KEY_RIGHT_CONTROL = 345, KEY_RIGHT_ALT = 346, KEY_A = 65, KEY_Z = 90;

    private static final String[] FUNCTION_KEYS = {
        "OP", "OQ", "OR", "OS", "[15~", "[17~", "[18~", "[19~", "[20~", "[21~", "[23~", "[24~",
    };

    /** The kind of a mouse event. */
    public enum Mouse {
        PRESS, RELEASE, DRAG, SCROLL,
    }

    private boolean shift;
    private boolean ctrl;
    private boolean alt;

    public boolean isCtrl() {
        return ctrl;
    }

    public boolean isAlt() {
        return alt;
    }

    public boolean isShift() {
        return shift;
    }

    /**
     * A key was pressed (or repeats).
     *
     * @return What the terminal sends, or {@code null} if the key sends nothing (modifiers, printable keys, which
     * arrive as typed characters).
     */
    public @Nullable String keyDown(int key) {
        if (trackModifier(key, true)) return null;

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
        if (ctrl && key >= KEY_A && key <= KEY_Z) return prefix() + (char) (key - KEY_A + 1);
        return null;
    }

    /** A key was released; only modifiers matter. */
    public void keyUp(int key) {
        trackModifier(key, false);
    }

    /**
     * A character was typed.
     *
     * @return What the terminal sends, or {@code null} while Ctrl is held.
     */
    public @Nullable String charTyped(char ch) {
        if (ctrl) return null;
        return prefix() + ch;
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
        if (alt) code += 8;
        if (ctrl) code += 16;

        if (sgr) return ESC + "[<" + code + ";" + x + ";" + y + (kind == Mouse.RELEASE ? "m" : "M");

        // X10: releases do not say which button; coordinates are limited to 223.
        if (kind == Mouse.RELEASE) code = 3 + (code & ~3);
        if (x > 223 || y > 223) return null;
        return ESC + "[M" + (char) (32 + code) + (char) (32 + x) + (char) (32 + y);
    }

    private boolean trackModifier(int key, boolean down) {
        switch (key) {
            case KEY_LEFT_SHIFT, KEY_RIGHT_SHIFT -> shift = down;
            case KEY_LEFT_CONTROL, KEY_RIGHT_CONTROL -> ctrl = down;
            case KEY_LEFT_ALT, KEY_RIGHT_ALT -> alt = down;
            default -> {
                return false;
            }
        }
        return true;
    }

    private String prefix() {
        return alt ? ESC : "";
    }

    /** xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
    private int modifiers() {
        return 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
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
}
