// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

/**
 * The GLFW key codes the client sends for key presses (see {@code org.lwjgl.glfw.GLFW}), which core cannot depend on.
 * Printable keys use the ASCII code of their (upper-case) character on a US keyboard.
 */
public final class GlfwKeys {
    public static final int KEY_SPACE = 32, KEY_APOSTROPHE = 39, KEY_COMMA = 44, KEY_MINUS = 45, KEY_PERIOD = 46,
        KEY_SLASH = 47, KEY_0 = 48, KEY_1 = 49, KEY_9 = 57, KEY_SEMICOLON = 59, KEY_EQUAL = 61, KEY_A = 65, KEY_Z = 90,
        KEY_LEFT_BRACKET = 91, KEY_BACKSLASH = 92, KEY_RIGHT_BRACKET = 93, KEY_GRAVE_ACCENT = 96;

    public static final int KEY_ESCAPE = 256, KEY_ENTER = 257, KEY_TAB = 258, KEY_BACKSPACE = 259, KEY_INSERT = 260,
        KEY_DELETE = 261, KEY_RIGHT = 262, KEY_LEFT = 263, KEY_DOWN = 264, KEY_UP = 265, KEY_PAGE_UP = 266,
        KEY_PAGE_DOWN = 267, KEY_HOME = 268, KEY_END = 269, KEY_CAPS_LOCK = 280, KEY_SCROLL_LOCK = 281,
        KEY_NUM_LOCK = 282, KEY_PRINT_SCREEN = 283, KEY_PAUSE = 284, KEY_F1 = 290, KEY_F12 = 301, KEY_F13 = 302,
        KEY_F25 = 314;

    public static final int KEY_KP_0 = 320, KEY_KP_9 = 329, KEY_KP_DECIMAL = 330, KEY_KP_DIVIDE = 331,
        KEY_KP_MULTIPLY = 332, KEY_KP_SUBTRACT = 333, KEY_KP_ADD = 334, KEY_KP_ENTER = 335, KEY_KP_EQUAL = 336;

    public static final int KEY_LEFT_SHIFT = 340, KEY_LEFT_CONTROL = 341, KEY_LEFT_ALT = 342, KEY_LEFT_SUPER = 343,
        KEY_RIGHT_SHIFT = 344, KEY_RIGHT_CONTROL = 345, KEY_RIGHT_ALT = 346, KEY_RIGHT_SUPER = 347, KEY_MENU = 348;

    private GlfwKeys() {
    }
}
