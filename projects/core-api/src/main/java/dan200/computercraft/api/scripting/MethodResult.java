// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import dan200.computercraft.api.peripheral.IComputerAccess;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;
import java.util.*;

/**
 * The result of invoking a Lua method.
 * <p>
 * Method results either return a value immediately ({@link #of(Object...)} or yield control to the parent coroutine.
 * When the current coroutine is resumed, we invoke the provided {@link ICallback#resume(Object[])} callback.
 */
public final class MethodResult {

    /**
     * Routes a captured continuation into the matching event-loop phase bucket.
     * A {@code null} destination means the result is returned to JS immediately — no continuation is captured.
     */
    public enum Bucket {
        /** Phase 1 — timer map; {@code result[0]} is the CC timer ID. */
        TIMER,
        /** Phase 2 — I/O map; {@code result[0]} (if String) is the event filter. Requires a callback. */
        IO,
        /** Phase 4 — yield queue; resumed with {@code undefined} next tick. */
        YIELD,
    }

    private static final MethodResult empty = new MethodResult((Object[]) null, null);

    private final @Nullable Object @Nullable [] result;
    private final @Nullable ICallback callback;
    private final int adjust;
    private final @Nullable Bucket destination;

    /** Immediate return — no continuation. Used by {@link #of} factories. */
    private MethodResult(@Nullable Object @Nullable [] arguments, @Nullable ICallback callback) {
        result = arguments;
        this.callback = callback;
        adjust = 0;
        destination = null;
    }

    /** Immediate return with error-level adjustment — no continuation. Used by {@link #adjustError}. */
    private MethodResult(@Nullable Object @Nullable [] arguments, @Nullable ICallback callback, int adjust) {
        result = arguments;
        this.callback = callback;
        this.adjust = adjust;
        destination = null;
    }

    /** Continuation with a callback (IO bucket). Used by {@link #pullEvent}, {@link #pullEventRaw}, {@link #yield}. */
    private MethodResult(Bucket destination, @Nullable Object @Nullable [] arguments, ICallback callback) {
        this.destination = destination;
        result = arguments;
        this.callback = callback;
        adjust = 0;
    }

    /** Continuation without a callback (TIMER / YIELD buckets). Used by {@link #awaitTimer}, {@link #awaitYield}. */
    private MethodResult(Bucket destination, @Nullable Object @Nullable [] arguments) {
        this.destination = destination;
        result = arguments;
        callback = null;
        adjust = 0;
    }

    /**
     * Return no values immediately.
     *
     * @return A method result which returns immediately with no values.
     */
    public static MethodResult of() {
        return empty;
    }

    /**
     * Return a single value immediately.
     * <p>
     * Integers, doubles, floats, strings, booleans, {@link Map}, {@link Collection}s, arrays and {@code null} will be
     * converted to their corresponding Lua type. {@code byte[]} and {@link ByteBuffer} will be treated as binary
     * strings. {@link IFunction} will be treated as a function.
     * <p>
     * In order to provide a custom object with methods, one may return a {@link IDynamicObject}, or an arbitrary
     * class with {@link ScriptFunction} annotations. Anything else will be converted to {@code nil}.
     * <p>
     * Shared objects in a {@link MethodResult} will preserve their sharing when converted to Lua values. For instance,
     * {@code Map<?, ?> m = new HashMap(); return MethodResult.of(m, m); } will return two values {@code a}, {@code b}
     * where {@code a == b}. The one exception to this is Java's singleton collections ({@link List#of()},
     * {@link Set#of()} and {@link Map#of()}), which are always converted to new table. This is not true for other
     * singleton collections, such as those provided by {@link Collections} or Guava.
     *
     * @param value The value to return to the calling Lua function.
     * @return A method result which returns immediately with the given value.
     */
    public static MethodResult of(@Nullable Object value) {
        return new MethodResult(new Object[]{ value }, null);
    }

    /**
     * Return any number of values immediately.
     *
     * @param values The values to return. See {@link #of(Object)} for acceptable values.
     * @return A method result which returns immediately with the given values.
     */
    public static MethodResult of(@Nullable Object @Nullable ... values) {
        return values == null || values.length == 0 ? empty : new MethodResult(values, null);
    }

    /**
     * Wait for an event to occur on the computer, suspending the thread until it arises. This method is exactly
     * equivalent to {@code os.pullEvent()} in lua.
     *
     * @param filter   A specific event to wait for, or null to wait for any event.
     * @param callback The callback to resume with the name of the event that occurred, and any event parameters.
     * @return The method result which represents this yield.
     * @see IComputerAccess#queueEvent(String, Object[])
     */
    public static MethodResult pullEvent(@Nullable String filter, ICallback callback) {
        Objects.requireNonNull(callback, "callback cannot be null");
        return new MethodResult(Bucket.IO, new Object[]{ filter }, results -> {
            if (results.length >= 1 && Objects.equals(results[0], "terminate")) {
                throw new ScriptException("Terminated", 0);
            }
            return callback.resume(results);
        });
    }

    /**
     * The same as {@link #pullEvent(String, ICallback)}, except "terminated" events are ignored. Only use this if
     * you want to prevent program termination, which is not recommended. This method is exactly equivalent to
     * {@code os.pullEventRaw()} in Lua.
     *
     * @param filter   A specific event to wait for, or null to wait for any event.
     * @param callback The callback to resume with the name of the event that occurred, and any event parameters.
     * @return The method result which represents this yield.
     * @see #pullEvent(String, ICallback)
     */
    public static MethodResult pullEventRaw(@Nullable String filter, ICallback callback) {
        Objects.requireNonNull(callback, "callback cannot be null");
        return new MethodResult(Bucket.IO, new Object[]{ filter }, callback);
    }

    /**
     * Suspend execution until the CC timer with the given ID fires (Phase 1 — timers).
     * The continuation is resumed with {@code undefined}; no callback is needed.
     *
     * @param timerId The CC timer ID returned by {@link dan200.computercraft.core.apis.IAPIEnvironment#startTimer}.
     * @return A method result that captures a continuation routed to the timer bucket.
     */
    public static MethodResult timer(int timerId) {
        return new MethodResult(Bucket.TIMER, new Object[]{ timerId });
    }

    /**
     * Suspend execution until the next game tick (Phase 4 — yields).
     * The continuation is resumed with {@code undefined} on the next {@code cc:yield} event.
     *
     * @return A method result that captures a continuation routed to the yield queue.
     */
    public static MethodResult yield() {
        return new MethodResult(Bucket.YIELD, new Object[0]);
    }

    public @Nullable Object @Nullable [] getResult() {
        return result;
    }

    @Nullable
    public ICallback getCallback() {
        return callback;
    }

    /**
     * The event-loop bucket this result routes to, or {@code null} if the value should be returned to JS immediately.
     */
    @Nullable
    public Bucket getDestination() {
        return destination;
    }

    public int getErrorAdjust() {
        return adjust;
    }

    /**
     * Increase the Lua error by a specific amount. One should never need to use this function - it largely exists for
     * some CC internal code.
     *
     * @param adjust The amount to increase the level by.
     * @return The new {@link MethodResult} with an adjusted error. This has no effect on immediate results.
     */
    public MethodResult adjustError(int adjust) {
        if (adjust < 0) throw new IllegalArgumentException("cannot adjust by a negative amount");
        if (adjust == 0 || callback == null) return this;
        return new MethodResult(result, callback, this.adjust + adjust);
    }
}
