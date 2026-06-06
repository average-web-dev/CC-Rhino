// SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.util;

import com.google.common.primitives.Primitives;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptValues;

import java.util.Collection;
import java.util.Map;

public class ScriptUtil {
    public static Object[] consArray(Object value, Collection<?> rest) {
        if (rest.isEmpty()) return new Object[]{ value };

        // I'm not proud of this code.
        var out = new Object[rest.size() + 1];
        out[0] = value;
        var i = 1;
        for (var additionalType : rest) out[i++] = additionalType;
        return out;
    }

    /**
     * Read a required, typed field from a table argument (e.g. a {@code { x, y }} position object).
     * <p>
     * Numbers are coerced to the requested numeric type ({@code int}/{@link Integer}, {@code long}/{@link Long} or
     * {@code double}/{@link Double}); a nested {@code record} type is coerced from a sub-table (see
     * {@link #toRecord(Map, Class)}); other types ({@link String}, {@link Boolean}, {@link Map}, …) must match exactly.
     * The type is supplied as a {@link Class} token, so this can be called generically, e.g.
     * {@code getField(pos, "x", Integer.class)}.
     *
     * @param table The table to read from.
     * @param key   The field to read.
     * @param type  The expected field type.
     * @param <T>   The expected field type.
     * @return The field's value, coerced to {@code type}.
     * @throws ScriptException If the field is missing or not of the expected type.
     */
    @SuppressWarnings("unchecked")
    public static <T> T getField(Map<?, ?> table, String key, Class<T> type) throws ScriptException {
        var value = table.get(key);
        if (type.isRecord() && value instanceof Map<?, ?> sub) return toRecord(sub, type);

        var wrapped = Primitives.wrap(type);
        if (value instanceof Number number) {
            if (wrapped == Integer.class) return (T) Integer.valueOf((int) number.longValue());
            if (wrapped == Long.class) return (T) Long.valueOf(number.longValue());
            if (wrapped == Double.class) return (T) Double.valueOf(number.doubleValue());
        }
        if (wrapped.isInstance(value)) return (T) value;
        throw ScriptValues.badField(key, expectedTypeName(wrapped), ScriptValues.getType(value));
    }

    /**
     * Coerce a table into a {@code record}, reading each {@linkplain Class#getRecordComponents() record component} from
     * the table by name (recursively, via {@link #getField(Map, String, Class)}) and invoking the canonical constructor.
     *
     * @param table The table to read from.
     * @param type  The record type to construct.
     * @param <T>   The record type to construct.
     * @return The constructed record.
     * @throws ScriptException If any field is missing or of the wrong type.
     */
    public static <T> T toRecord(Map<?, ?> table, Class<T> type) throws ScriptException {
        var components = type.getRecordComponents();
        if (components == null) throw new IllegalArgumentException(type + " is not a record");

        var arguments = new Object[components.length];
        var parameterTypes = new Class<?>[components.length];
        for (var i = 0; i < components.length; i++) {
            parameterTypes[i] = components[i].getType();
            arguments[i] = getField(table, components[i].getName(), components[i].getType());
        }

        try {
            var constructor = type.getDeclaredConstructor(parameterTypes);
            constructor.setAccessible(true);
            return constructor.newInstance(arguments);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot construct record " + type.getName(), e);
        }
    }

    private static String expectedTypeName(Class<?> type) {
        if (Number.class.isAssignableFrom(type)) return "number";
        if (type == String.class) return "string";
        if (type == Boolean.class) return "boolean";
        if (Map.class.isAssignableFrom(type) || type.isRecord()) return "table";
        return type.getSimpleName();
    }
}
