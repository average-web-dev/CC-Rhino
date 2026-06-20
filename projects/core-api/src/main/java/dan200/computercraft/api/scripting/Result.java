// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

/**
 * The outcome of a "can-fail" script action: a success, or a failure carrying a human-readable reason.
 *
 * <p>This is the house convention for operations a script routinely branches on (equipping an upgrade,
 * moving a turtle, …), replacing the Lua {@code (ok, err)} multiple-return idiom. It surfaces to TypeScript
 * as {@code { ok: boolean; reason: string | null }}; use {@link #succeed()} / {@link #fail(String)} to build one.
 * Reserve thrown exceptions for genuinely exceptional conditions (misuse, unavailable APIs).
 */
public record Result(boolean ok, @Nullable String reason) {
    /** A successful result, with no reason. */
    public static Result succeed() {
        return new Result(true, null);
    }

    /** A failed result, explaining why. */
    public static Result fail(@Nullable String reason) {
        return new Result(false, reason);
    }
}
