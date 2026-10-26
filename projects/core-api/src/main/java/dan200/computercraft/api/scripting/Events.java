// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Helpers for turning an {@link Event}-annotated record into the {@code (name, args)} pair that
 * {@code queueEvent} expects. The record's {@link Event#value()} is the event name and its components,
 * in declaration order, are the arguments — the same order the generated TypeScript {@code EventMap} uses.
 *
 * <p>Also keeps the registry of <em>native</em> event names ({@link #register}, {@link #isNative}). Scripts may emit
 * their own events with {@code events.emit}, but not native ones: otherwise a program could fake input
 * ({@code key}, {@code char}), timers or the completion of another program's task ({@code task_complete}).
 */
public final class Events {
    private static final Set<String> NATIVE = ConcurrentHashMap.newKeySet();

    private Events() {
    }

    /**
     * Register native events, which scripts cannot emit themselves with {@code events.emit}.
     *
     * <p>Each class is either an {@link Event} record, or a holder class whose nested {@link Event} records are all
     * registered (e.g. {@code CoreEvents}). Mods that declare their own event records should register them once at
     * startup.
     *
     * @param types The event records or holder classes to register.
     */
    public static void register(Class<?>... types) {
        for (var type : types) {
            var annotation = type.getAnnotation(Event.class);
            if (annotation != null) {
                NATIVE.add(annotation.value());
                continue;
            }
            var found = false;
            for (var nested : type.getDeclaredClasses()) {
                var nestedAnnotation = nested.getAnnotation(Event.class);
                if (nestedAnnotation == null) continue;
                NATIVE.add(nestedAnnotation.value());
                found = true;
            }
            if (!found) throw new IllegalArgumentException(type.getName() + " declares no @Event records");
        }
    }

    /** Register native event names that have no {@link Event} record (e.g. engine-internal events). */
    public static void registerNames(String... names) {
        NATIVE.addAll(Arrays.asList(names));
    }

    /**
     * Whether {@code name} is a native event (see {@link #register}).
     *
     * @param name The event name.
     * @return Whether scripts are not allowed to emit this event.
     */
    public static boolean isNative(String name) {
        return NATIVE.contains(name);
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
