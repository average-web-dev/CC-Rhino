// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

import java.util.ArrayList;
import java.util.Arrays;

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

    /**
     * The record's components, in declaration order, as event arguments. A varargs record
     * ({@code record Foo(String... args)}) spreads its last component, so the event gets one argument per element.
     */
    public static @Nullable Object[] arguments(Record event) {
        var type = event.getClass();
        var components = type.getRecordComponents();
        var args = new ArrayList<@Nullable Object>(components.length);
        try {
            for (var i = 0; i < components.length; i++) {
                var value = components[i].getAccessor().invoke(event);
                if (i == components.length - 1 && isVarArgs(type) && value instanceof Object[] rest) {
                    args.addAll(Arrays.asList(rest));
                } else {
                    args.add(value);
                }
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot read components of " + type.getName(), e);
        }
        return args.toArray();
    }

    private static boolean isVarArgs(Class<?> record) {
        var components = record.getRecordComponents();
        var types = new Class<?>[components.length];
        for (var i = 0; i < components.length; i++) types[i] = components[i].getType();
        try {
            return record.getDeclaredConstructor(types).isVarArgs();
        } catch (NoSuchMethodException e) {
            return false;
        }
    }
}
