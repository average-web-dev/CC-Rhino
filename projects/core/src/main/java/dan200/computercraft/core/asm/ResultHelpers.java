// SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.asm;

import dan200.computercraft.api.scripting.MethodResult;
import org.jspecify.annotations.Nullable;

final class ResultHelpers {
    private ResultHelpers() {
    }

    static MethodResult checkNormalResult(MethodResult result) {
        if (result.getCallback() != null) {
            // Due to how tasks are implemented, we can't currently return a MethodResult. This is an
            // entirely artificial limitation - we can remove it if it ever becomes an issue.
            throw new IllegalStateException("Must return MethodResult.of from mainThread function.");
        }

        // Hand the whole result back to the task (TaskCallback returns it as is), so that no result (a void method,
        // undefined in JS) stays apart from a null one.
        return result;
    }

    /** A {@code null} return as no result ({@code undefined} in JS), for {@code @ScriptFunction(undefinedIfNull = true)}. */
    static MethodResult undefinedIfNull(@Nullable Object value) {
        return value == null ? MethodResult.of() : MethodResult.of(value);
    }

    static RuntimeException throwUnchecked(Throwable t) {
        return throwUnchecked0(t);
    }

    @SuppressWarnings({ "unchecked", "TypeParameterUnusedInFormals" })
    private static <T extends Throwable> T throwUnchecked0(Throwable t) throws T {
        throw (T) t;
    }
}
