// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

import java.util.Map;

/**
 * The outcome of a turtle inspect command.
 *
 * <p>Use {@link #found(Map)} / {@link #notFound(String)} to construct.
 *
 * @cc-r.union {@code { success: true; data: { name: string; mapColor: number; mapColour: number; state: Record<string, unknown>; tags: Record<string, boolean> } } | { success: false; reason: string }}
 */
public record InspectResult(boolean success, @Nullable Map<?, ?> data, @Nullable String reason) {
    /** A successful inspect — a block was found and its details are in {@code data}. */
    public static InspectResult found(Map<?, ?> data) {
        return new InspectResult(true, data, null);
    }

    /** A failed inspect — no block was present. */
    public static InspectResult notFound(String reason) {
        return new InspectResult(false, null, reason);
    }
}
