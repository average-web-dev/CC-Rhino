// SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.util;

import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.LuaValues;
import dan200.computercraft.core.lua.ILuaMachine;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class LuaUtil {
    private static final List<?> EMPTY_LIST = List.of();
    private static final Set<?> EMPTY_SET = Set.of();
    private static final Map<?, ?> EMPTY_MAP = Map.of();

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
     * Determine whether a value is a singleton collection, such as one created with {@link List#of()}.
     * <p>
     * These collections are treated specially by {@link ILuaMachine} implementations: we skip sharing for them, and
     * create a new table each time.
     *
     * @param value The value to test.
     * @return Whether this is a singleton collection.
     */
    public static boolean isSingletonCollection(Collection<?> value) {
        return value == EMPTY_LIST || value == EMPTY_SET;
    }

    /**
     * Determine whether a value is a singleton map, such as one created with {@link Map#of()}.
     * <p>
     * These collections are treated specially by {@link ILuaMachine} implementations: we skip sharing for them, and
     * create a new table each time.
     *
     * @param value The value to test.
     * @return Whether this is a singleton map.
     */
    public static boolean isSingletonMap(Map<?, ?> value) {
        return value == EMPTY_MAP;
    }

    /**
     * Read a required, typed field from a table argument (e.g. a {@code { x, y }} position object).
     * <p>
     * Numbers are coerced to the requested numeric type ({@link Integer}, {@link Long} or {@link Double}); other types
     * ({@link String}, {@link Boolean}, {@link Map}, …) must match exactly. The type is supplied as a {@link Class}
     * token, so this can be called generically, e.g. {@code getField(pos, "x", Integer.class)}.
     *
     * @param table The table to read from.
     * @param key   The field to read.
     * @param type  The expected field type.
     * @param <T>   The expected field type.
     * @return The field's value, coerced to {@code type}.
     * @throws LuaException If the field is missing or not of the expected type.
     */
    public static <T> T getField(Map<?, ?> table, String key, Class<T> type) throws LuaException {
        var value = table.get(key);
        if (value instanceof Number number) {
            if (type == Integer.class) return type.cast((int) number.longValue());
            if (type == Long.class) return type.cast(number.longValue());
            if (type == Double.class) return type.cast(number.doubleValue());
        }
        if (type.isInstance(value)) return type.cast(value);
        throw LuaValues.badField(key, expectedTypeName(type), LuaValues.getType(value));
    }

    private static String expectedTypeName(Class<?> type) {
        if (Number.class.isAssignableFrom(type)) return "number";
        if (type == String.class) return "string";
        if (type == Boolean.class) return "boolean";
        if (Map.class.isAssignableFrom(type)) return "table";
        return type.getSimpleName();
    }
}
