// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.ScriptException;
import org.jspecify.annotations.Nullable;

import java.io.Serial;

/**
 * A Lua exception which does not contain its stack trace.
 */
public class FastScriptException extends ScriptException {
    @Serial
    private static final long serialVersionUID = 5957864899303561143L;

    public FastScriptException(@Nullable String message) {
        super(message);
    }

    public FastScriptException(@Nullable String message, int level) {
        super(message, level);
    }

    @Override
    public synchronized Throwable fillInStackTrace() {
        return this;
    }
}
