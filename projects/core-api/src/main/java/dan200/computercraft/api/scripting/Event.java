// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a record as the definition of a script event.
 *
 * <p>The record's components describe the event's arguments, in order, and {@link #value()} is the event name
 * (as passed to {@code queueEvent}). These definitions drive the generated TypeScript {@code EventMap}, which
 * in turn types {@code events.on} / {@code once} / {@code off}.
 *
 * <pre>{@code
 * @Event("redstone")
 * public record RedstoneEvent(String side, int strength) {}
 * }</pre>
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Event {
    /** The event's name, as passed to {@code queueEvent}. */
    String value();
}
