// SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.asm;

import dan200.computercraft.api.scripting.MethodResult;
import org.jspecify.annotations.Nullable;

final class ResultHelpers {
    private ResultHelpers() {
    }

    static @Nullable Object checkNormalResult(MethodResult result) {
        if (result.getCallback() != null) {
            // Due to how tasks are implemented, we can't currently return a MethodResult. This is an
            // entirely artificial limitation - we can remove it if it ever becomes an issue.
            throw new IllegalStateException("Must return MethodResult.of from mainThread function.");
        }

        // A MethodResult now carries exactly one value; hand that lone value back to the task.
        var values = result.getResult();
        return values == null || values.length == 0 ? null : values[0];
    }

    static RuntimeException throwUnchecked(Throwable t) {
        return throwUnchecked0(t);
    }

    @SuppressWarnings({ "unchecked", "TypeParameterUnusedInFormals" })
    private static <T extends Throwable> T throwUnchecked0(Throwable t) throws T {
        throw (T) t;
    }
}
