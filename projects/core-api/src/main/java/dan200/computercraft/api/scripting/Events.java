// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

/**
 * Helpers for turning an {@link Event}-annotated record into the {@code (name, args)} pair that
 * {@code queueEvent} expects. The record's {@link Event#value()} is the event name and its components,
 * in declaration order, are the arguments — the same order the generated TypeScript {@code EventMap} uses.
 */
public final class Events {
    private Events() {
    }

    /** The event name from the record's {@link Event} annotation. */
    public static String name(Record event) {
        var annotation = event.getClass().getAnnotation(Event.class);
        if (annotation == null) {
            throw new IllegalArgumentException(event.getClass().getName() + " is not annotated @Event");
        }
        return annotation.value();
    }

    /** The record's components, in declaration order, as event arguments. */
    public static Object[] arguments(Record event) {
        var components = event.getClass().getRecordComponents();
        var args = new Object[components.length];
        try {
            for (var i = 0; i < components.length; i++) args[i] = components[i].getAccessor().invoke(event);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot read components of " + event.getClass().getName(), e);
        }
        return args;
    }
}
