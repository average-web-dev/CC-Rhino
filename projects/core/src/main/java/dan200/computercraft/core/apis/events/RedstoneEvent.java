// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.events;

import dan200.computercraft.api.scripting.Event;

/** Fired when the redstone state on one of the computer's sides changes. */
@Event("redstone")
public record RedstoneEvent(String side, int strength) {
}
