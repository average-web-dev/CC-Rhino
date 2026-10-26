// SPDX-FileCopyrightText: 2025 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.input;

import dan200.computercraft.api.scripting.Events;
import dan200.computercraft.core.apis.events.CharEvent;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.apis.events.KeyEvent;
import dan200.computercraft.core.computer.Computer;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;

/**
 * A {@link ComputerInput} that queues events on the computer.
 */
public final class EventComputerInput implements ComputerInput {
    private final QueueEvent receiver;

    public EventComputerInput(QueueEvent receiver) {
        this.receiver = receiver;
    }

    public EventComputerInput(Computer computer) {
        this(computer::queueEvent);
    }

    @Override
    public void keyDown(int key, boolean repeat) {
        receiver.queueEvent(new KeyEvent(key, repeat));
    }

    @Override
    public void keyUp(int key) {
        receiver.queueEvent(new CoreEvents.KeyUp(key));
    }

    @Override
    public void charTyped(byte chr) {
        receiver.queueEvent(new CharEvent(String.valueOf((char) (chr & 0xFF))));
    }

    @Override
    public void paste(ByteBuffer contents) {
        receiver.queueEvent(new CoreEvents.Paste(contents));
    }

    @Override
    public void mouseClick(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseClick(button, x, y));
    }

    @Override
    public void mouseUp(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseUp(button, x, y));
    }

    @Override
    public void mouseDrag(int button, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseDrag(button, x, y));
    }

    @Override
    public void mouseScroll(int direction, int x, int y) {
        receiver.queueEvent(new CoreEvents.MouseScroll(direction, x, y));
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
