// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

/**
 * A function, which can be called from Lua. If you need to return a table of functions, it is recommended to use
 * an object with {@link ScriptFunction} methods, or implement {@link IDynamicObject}.
 *
 * @see MethodResult#of(Object)
 */
@FunctionalInterface
public interface IFunction {
    /**
     * Call this function with a series of arguments. Note, this will <em>always</em> be called on the computer thread,
     * and so its implementation must be thread-safe.
     *
     * @param arguments The arguments for this function
     * @return The result of calling this function.
     * @throws ScriptException Upon Lua errors.
     */
    MethodResult call(IArguments arguments) throws ScriptException;

    /**
     * Whether this function never yields, i.e. always returns {@link MethodResult#of(Object)}. A function that may
     * yield (the default, as it cannot be known in advance) is treated as blocking: it cannot be called from async
     * code (generators, promise callbacks) or from callbacks run by native code, and is rejected there before it runs.
     *
     * @return Whether this function never yields.
     * @see #nonYielding(IFunction)
     */
    default boolean isNonYielding() {
        return false;
    }

    /**
     * Mark a function as never yielding (see {@link #isNonYielding()}), so it can be called anywhere, including async
     * code.
     *
     * @param function The function, which must only ever return immediate results.
     * @return A function with the same behaviour that reports itself as non-yielding.
     */
    static IFunction nonYielding(IFunction function) {
        return new IFunction() {
            @Override
            public MethodResult call(IArguments arguments) throws ScriptException {
                return function.call(arguments);
            }

            @Override
            public boolean isNonYielding() {
                return true;
            }
        };
    }
}
