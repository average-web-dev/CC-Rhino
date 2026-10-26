// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.peripheral;

import dan200.computercraft.api.scripting.Event;
import org.jspecify.annotations.Nullable;

/**
 * Declarations of the events queued by CC's blocks and peripherals, which type {@code events.on} in the generated
 * TypeScript {@code EventMap}. The components are the event's arguments, in order; they must match what the queueing
 * code passes to {@code queueEvent}. {@code side} is the peripheral's attachment name.
 *
 * @see dan200.computercraft.core.apis.events.CoreEvents
 */
public final class PeripheralEvents {
    private PeripheralEvents() {
    }

    /**
     * A modem received a message on an open channel. {@code distance} is {@code null} for messages from another
     * dimension.
     *
     * @cc-r.param message unknown
     */
    @Event("modem_message")
    public record ModemMessage(String side, int channel, int replyChannel, Object message, @Nullable Double distance) {
    }

    /** A monitor changed size. */
    @Event("monitor_resize")
    public record MonitorResize(String side) {
    }

    /** An advanced monitor was right-clicked. */
    @Event("monitor_touch")
    public record MonitorTouch(String side, int x, int y) {
    }

    /** A disk was inserted into a disk drive. */
    @Event("disk")
    public record DiskInsert(String side) {
    }

    /** A disk was removed from a disk drive. */
    @Event("disk_eject")
    public record DiskEject(String side) {
    }

    /** A speaker has room for more audio after {@code playAudio} filled its buffer. */
    @Event("speaker_audio_empty")
    public record SpeakerAudioEmpty(String side) {
    }

    /** The turtle's inventory changed. */
    @Event("turtle_inventory")
    public record TurtleInventory() {
    }

    /** A command computer was sent arguments with {@code /computercraft queue}: one event argument per word. */
    @Event("computer_command")
    public record ComputerCommand(String... args) {
    }
}
