// SPDX-FileCopyrightText: 2025 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.input;

import dan200.computercraft.core.computer.Computer;
import dan200.computercraft.core.tty.InputEncoder;
import dan200.computercraft.core.tty.Screen;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * A {@link ComputerInput} for a computer: keys, typed characters, pasted text and the mouse go to the visible console
 * of its {@link Screen} only (programs read them from its TTY, as on Linux: pasted text as typed, or bracketed if the
 * program asked for it; mouse reports only if it asked for the mouse).
 */
public final class EventComputerInput implements ComputerInput {
    private final Screen screen;

    public EventComputerInput(Computer computer) {
        screen = computer.getScreen();
    }

    @Override
    public void keyDown(int key, boolean repeat) {
        screen.keyDown(key, repeat);
    }

    @Override
    public void keyUp(int key) {
        screen.keyUp(key);
    }

    @Override
    public void charTyped(byte chr) {
        screen.charTyped((char) (chr & 0xFF));
    }

    @Override
    public void paste(ByteBuffer contents) {
        screen.paste(StandardCharsets.ISO_8859_1.decode(contents.duplicate()).toString());
    }

    @Override
    public void mouseClick(int button, int x, int y) {
        screen.mouse(InputEncoder.Mouse.PRESS, button, x, y);
    }

    @Override
    public void mouseUp(int button, int x, int y) {
        screen.mouse(InputEncoder.Mouse.RELEASE, button, x, y);
    }

    @Override
    public void mouseDrag(int button, int x, int y) {
        screen.mouse(InputEncoder.Mouse.DRAG, button, x, y);
    }

    @Override
    public void mouseScroll(int direction, int x, int y) {
        screen.mouse(InputEncoder.Mouse.SCROLL, direction, x, y);
    }
}
