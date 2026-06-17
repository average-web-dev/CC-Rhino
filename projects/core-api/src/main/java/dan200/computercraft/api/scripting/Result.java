// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

/**
 * The outcome of a "can-fail" script action: a success, or a failure carrying a human-readable reason.
 *
 * <p>This is the house convention for operations a script routinely branches on (equipping an upgrade,
 * moving a turtle, …), replacing the Lua {@code (ok, err)} multiple-return idiom.
 * Use {@link #succeed()} / {@link #fail(String)} to build one.
 * Reserve thrown exceptions for genuinely exceptional conditions (misuse, unavailable APIs).
 *
 * @cc-r.union {@code { success: true } | { success: false; reason: string }}
 */
public record Result(boolean success, @Nullable String reason) {
    /** A successful result, with no reason. */
    public static Result succeed() {
        return new Result(true, null);
    }

    /** A failed result, explaining why. */
    public static Result fail(String reason) {
        return new Result(false, reason);
    }
}
