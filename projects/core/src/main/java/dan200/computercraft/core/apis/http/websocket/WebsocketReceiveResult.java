// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.http.websocket;

import org.jspecify.annotations.Nullable;

/**
 * The outcome of {@link WebsocketHandle#receive}: a message, or the reason none arrived (the socket was closed, or
 * the wait timed out).
 *
 * @param success Whether a message was received.
 * @param message The message (a binary string), when one was received.
 * @param binary  Whether the message was sent as a binary frame, when one was received.
 * @param reason  Why no message was received: the close reason or {@code "Timed out"}.
 * @cc-r.interface
 * @cc-r.union {@code { success: true; message: string; binary: boolean } | { success: false; reason: string }}
 */
public record WebsocketReceiveResult(
    boolean success, @Nullable Object message, @Nullable Boolean binary, @Nullable String reason
) {
    /** A received message. */
    public static WebsocketReceiveResult message(@Nullable Object message, boolean binary) {
        return new WebsocketReceiveResult(true, message, binary, null);
    }

    /** No message was received. */
    public static WebsocketReceiveResult fail(String reason) {
        return new WebsocketReceiveResult(false, null, null, reason);
    }
}
