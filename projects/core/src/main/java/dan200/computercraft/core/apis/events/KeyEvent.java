// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.events;

import dan200.computercraft.api.scripting.Event;

/** Fired when a key is pressed. {@code held} is {@code true} when the press is a hold-repeat. */
@Event("key")
public record KeyEvent(int key, boolean held) {
}
