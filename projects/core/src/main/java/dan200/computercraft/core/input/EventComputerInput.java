// SPDX-FileCopyrightText: 2025 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.input;

import dan200.computercraft.api.scripting.Events;
import dan200.computercraft.core.apis.events.CharEvent;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.apis.events.KeyEvent;
import dan200.computercraft.core.computer.Computer;
import dan200.computercraft.core.tty.InputEncoder;
import dan200.computercraft.core.tty.Screen;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * A {@link ComputerInput} that queues events on the computer and, for a computer, also feeds the visible console of
 * its {@link Screen}.
 */
public final class EventComputerInput implements ComputerInput {
    private final QueueEvent receiver;
    private final @Nullable Screen screen;

    public EventComputerInput(QueueEvent receiver) {
        this(receiver, null);
    }

    public EventComputerInput(Computer computer) {
        this(computer::queueEvent, computer.getScreen());
    }

    private EventComputerInput(QueueEvent receiver, @Nullable Screen screen) {
        this.receiver = receiver;
        this.screen = screen;
    }

    @Override
    public void keyDown(int key, boolean repeat) {
        receiver.queueEvent(new KeyEvent(key, repeat));
        if (screen != null) screen.keyDown(key);
    }

    @Override
    public void keyUp(int key) {
        receiver.queueEvent(new CoreEvents.KeyUp(key));
        if (screen != null) screen.keyUp(key);
    }

    @Override
    public void charTyped(byte chr) {
        receiver.queueEvent(new CharEvent(String.valueOf((char) (chr & 0xFF))));
        if (screen != null) screen.charTyped((char) (chr & 0xFF));
    }

    @Override
    public void paste(ByteBuffer contents) {
        if (screen != null) screen.paste(StandardCharsets.ISO_8859_1.decode(contents.duplicate()).toString());
        receiver.queueEvent(new CoreEvents.Paste(contents));
    }

    @Override
    public void mouseClick(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseClick(button, x, y));
        if (screen != null) screen.mouse(InputEncoder.Mouse.PRESS, button, x, y);
    }

    @Override
    public void mouseUp(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseUp(button, x, y));
        if (screen != null) screen.mouse(InputEncoder.Mouse.RELEASE, button, x, y);
    }

    @Override
    public void mouseDrag(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseDrag(button, x, y));
        if (screen != null) screen.mouse(InputEncoder.Mouse.DRAG, button, x, y);
    }

    @Override
    public void mouseScroll(int direction, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseScroll(direction, x, y));
        if (screen != null) screen.mouse(InputEncoder.Mouse.SCROLL, direction, x, y);
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
