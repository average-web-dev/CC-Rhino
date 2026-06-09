// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

/**
 * A continuation which is called when this coroutine is resumed.
 *
 * @see MethodResult#pullEvent(String, ICallback)
 */
public interface ICallback {
    /**
     * Resume this coroutine.
     *
     * @param args The result of resuming this coroutine. These will have the same form as described in
     *             {@link ScriptFunction}.
     * @return The result of this continuation. Either the result to return to the callee, or another yield.
     * @throws ScriptException On an error.
     */
    MethodResult resume(@Nullable Object[] args) throws ScriptException;
}
