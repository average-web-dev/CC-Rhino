// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.events;

import dan200.computercraft.api.scripting.Event;

/** Fired when the user types a character. */
@Event("char")
public record CharEvent(String ch) {
}
