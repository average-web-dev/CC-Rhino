// SPDX-FileCopyrightText: 2025 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.input;

import dan200.computercraft.api.scripting.Events;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.computer.Computer;
import dan200.computercraft.core.tty.InputEncoder;
import dan200.computercraft.core.tty.Screen;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * A {@link ComputerInput} for a computer: keys and typed characters go to the visible console of its {@link Screen}
 * only (programs read them from its TTY, as on Linux); paste and mouse input also queue events on the computer.
 */
public final class EventComputerInput implements ComputerInput {
    private final QueueEvent receiver;
    private final Screen screen;

    public EventComputerInput(Computer computer) {
        receiver = computer::queueEvent;
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
        receiver.queueEvent(new CoreEvents.Paste(contents));
    }

    @Override
    public void mouseClick(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseClick(button, x, y));
        screen.mouse(InputEncoder.Mouse.PRESS, button, x, y);
    }

    @Override
    public void mouseUp(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseUp(button, x, y));
        screen.mouse(InputEncoder.Mouse.RELEASE, button, x, y);
    }

    @Override
    public void mouseDrag(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseDrag(button, x, y));
        screen.mouse(InputEncoder.Mouse.DRAG, button, x, y);
    }

    @Override
    public void mouseScroll(int direction, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseScroll(direction, x, y));
        screen.mouse(InputEncoder.Mouse.SCROLL, direction, x, y);
    }

    /**
     * A function to queue events.
     */
    @FunctionalInterface
    public interface QueueEvent {
        void queueEvent(String event, @Nullable Object @Nullable [] arguments);

        /** Queue an {@link dan200.computercraft.api.scripting.Event @Event} record (see {@link Events}). */
        default void queueEvent(Record event) {
            queueEvent(Events.name(event), Events.arguments(event));
        }
    }
}
