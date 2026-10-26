// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.events;

import dan200.computercraft.api.scripting.Event;
import dan200.computercraft.core.apis.http.request.HttpResponseHandle;
import dan200.computercraft.core.apis.http.websocket.WebsocketHandle;
import dan200.computercraft.core.apis.transfer.TransferredFiles;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;

/**
 * Declarations of the events queued by the core runtime and APIs, which type {@code events.on} in the generated
 * TypeScript {@code EventMap}. The components are the event's arguments, in order; they must match what the queueing
 * code passes to {@code queueEvent}.
 *
 * @see dan200.computercraft.api.scripting.Event
 */
public final class CoreEvents {
    private CoreEvents() {
    }

    /** A timer started with {@code system.startTimer} fired. */
    @Event("timer")
    public record Timer(int id) {
    }

    /** An alarm set with {@code system.setAlarm} fired. */
    @Event("alarm")
    public record Alarm(int id) {
    }

    /** Ctrl+T was held: the foreground program should stop. */
    @Event("terminate")
    public record Terminate() {
    }

    /** A key was released. */
    @Event("key_up")
    public record KeyUp(int key) {
    }

    /** Text was pasted into the computer. */
    @Event("paste")
    public record Paste(ByteBuffer text) {
    }

    /** A mouse button was pressed (advanced computers only). */
    @Event("mouse_click")
    public record MouseClick(int button, int x, int y) {
    }

    /** A mouse button was released. */
    @Event("mouse_up")
    public record MouseUp(int button, int x, int y) {
    }

    /** The mouse was moved while a button was held. */
    @Event("mouse_drag")
    public record MouseDrag(int button, int x, int y) {
    }

    /** The mouse wheel was scrolled: {@code direction} is -1 (up) or 1 (down). */
    @Event("mouse_scroll")
    public record MouseScroll(int direction, int x, int y) {
    }

    /** A peripheral was attached on a side (or a remote peripheral appeared on a wired network). */
    @Event("peripheral")
    public record PeripheralAttach(String side) {
    }

    /** A peripheral was detached. */
    @Event("peripheral_detach")
    public record PeripheralDetach(String side) {
    }

    /**
     * A main-thread task finished: {@code result} is the task's value on success, or the error message on failure.
     *
     * @cc-r.param result unknown
     */
    @Event("task_complete")
    public record TaskComplete(long id, boolean success, @Nullable Object result) {
    }

    /** An HTTP request succeeded. */
    @Event("http_success")
    public record HttpSuccess(String url, HttpResponseHandle response) {
    }

    /** An HTTP request failed; {@code response} is set when the server answered with an error status. */
    @Event("http_failure")
    public record HttpFailure(String url, String reason, @Nullable HttpResponseHandle response) {
    }

    /** The result of {@code http.checkURL}. */
    @Event("http_check")
    public record HttpCheck(String url, boolean success, @Nullable String reason) {
    }

    /** A websocket connected. */
    @Event("websocket_success")
    public record WebsocketSuccess(String url, WebsocketHandle websocket) {
    }

    /** A websocket could not connect. */
    @Event("websocket_failure")
    public record WebsocketFailure(String url, String reason) {
    }

    /** A websocket was closed by the server. */
    @Event("websocket_closed")
    public record WebsocketClosed(String url, @Nullable String reason, @Nullable Integer code) {
    }

    /** A websocket received a message (a binary string). */
    @Event("websocket_message")
    public record WebsocketMessage(String url, ByteBuffer message, boolean binary) {
    }

    /**
     * A promise was rejected without a handler, and no running thread owns it (a program's own unhandled rejections
     * fail that program instead). Emitted by the engine to {@code events.on} listeners only; it is not queued.
     * {@code error} is {@code Error("Unhandled promise rejection: …")} with the reason as its {@code cause}.
     *
     * @cc-r.param error Error
     */
    @Event("unhandled_rejection")
    public record UnhandledRejection(Object error) {
    }

    /** Files were dropped onto the computer's terminal. */
    @Event("file_transfer")
    public record FileTransfer(TransferredFiles files) {
    }
}
