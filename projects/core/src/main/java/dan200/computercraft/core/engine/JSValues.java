// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.IFunction;
import dan200.computercraft.api.scripting.ScriptException;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.nio.ByteBuffer;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.Map;

public final class JSValues {
    private static final IContext NO_CONTEXT = task -> {
        throw new ScriptException("Cannot run main-thread tasks from a returned function");
    };

    /** Maximum nesting depth of objects/arrays converted by {@link #toJava(Object)}. */
    static final int MAX_DEPTH = 128;

    /** Marks a JS object whose conversion is still in progress (i.e. it is on the current path). */
    private static final Object IN_PROGRESS = new Object();

    private JSValues() {}

    /** The Java representation of a JS object (or, as {@link ArrayTable}, a JS array) produced by {@link #toJava}. */
    @SuppressWarnings("serial")
    static class JSTable extends LinkedHashMap<Object, Object> {
    }

    /**
     * The Java representation of a JS array: a {@link Map} with 1-based {@link Long} keys (holes and unconvertible
     * elements are absent), which also remembers the array's length so {@link #toJs} can rebuild it as a JS array.
     */
    @SuppressWarnings("serial")
    static final class ArrayTable extends JSTable {
        private final long length;

        ArrayTable(long length) {
            this.length = length;
        }

        long length() {
            return length;
        }
    }

    /**
     * Convert a Java/CC value to a Rhino JS value.
     * <p>
     * {@link Collection}s, {@code Object[]} and {@linkplain ArrayTable converted JS arrays} become JS arrays; any
     * other {@link Map} becomes a plain object (numeric keys are used as-is, without shifting). Cyclic Java
     * references become cyclic JS references, and values that came from JS keep their shared references.
     *
     * @param cx    The current Rhino context.
     * @param scope The scope to create objects in.
     * @param java  The value to convert.
     * @return The converted value, or {@code null} if it cannot be represented.
     */
    public static @Nullable Object toJs(Context cx, Scriptable scope, @Nullable Object java) {
        return toJs(cx, scope, java, new IdentityHashMap<>());
    }

    private static @Nullable Object toJs(Context cx, Scriptable scope, @Nullable Object java, IdentityHashMap<Object, Scriptable> seen) {
        if (java == null) return null;
        if (java instanceof Boolean || java instanceof String) return java;
        if (java instanceof Number n) return n.doubleValue();
        if (java instanceof byte[] bytes) {
            var sb = new StringBuilder(bytes.length);
            for (var b : bytes) sb.append((char) (b & 0xFF));
            return sb.toString();
        }
        if (java instanceof ByteBuffer buf) {
            var sb = new StringBuilder(buf.remaining());
            var slice = buf.slice();
            while (slice.hasRemaining()) sb.append((char) (slice.get() & 0xFF));
            return sb.toString();
        }

        // A Java object that is already being converted further up (a cycle) maps to the same JS object. Otherwise
        // only tables that came from JS keep their sharing (restoring the original aliasing, and avoiding exponential
        // work on DAG-shaped values): repeated Java values (e.g. two List.of()) still become separate JS objects.
        var existing = seen.get(java);
        if (existing != null) return existing;

        var result = toJsTable(cx, scope, java, seen);
        if (!(java instanceof JSTable)) seen.remove(java);
        return result;
    }

    private static @Nullable Object toJsTable(Context cx, Scriptable scope, Object java, IdentityHashMap<Object, Scriptable> seen) {
        if (java instanceof Object[] arr) {
            var jsArr = cx.newArray(scope, 0);
            seen.put(java, jsArr);
            for (var i = 0; i < arr.length; i++) jsArr.put(i, jsArr, toJs(cx, scope, arr[i], seen));
            return jsArr;
        }
        if (java instanceof Collection<?> col) {
            var items = col.toArray();
            var jsArr = cx.newArray(scope, 0);
            seen.put(java, jsArr);
            for (var i = 0; i < items.length; i++) jsArr.put(i, jsArr, toJs(cx, scope, items[i], seen));
            return jsArr;
        }
        if (java instanceof ArrayTable table) {
            // A JS array that went through toJava: shift the 1-based keys back and restore the original length (so
            // holes, including trailing ones, survive the round trip).
            var jsArr = cx.newArray(scope, 0);
            seen.put(java, jsArr);
            for (var entry : table.entrySet()) {
                if (!(entry.getKey() instanceof Long key) || key < 1 || key > table.length()) continue;
                putProperty(jsArr, key - 1, toJs(cx, scope, entry.getValue(), seen));
            }
            jsArr.put("length", jsArr, (double) table.length());
            return jsArr;
        }
        if (java instanceof Map<?, ?> map) {
            var obj = cx.newObject(scope);
            seen.put(java, obj);
            for (var entry : map.entrySet()) {
                var key = entry.getKey();
                if (key == null) continue;
                var val = toJs(cx, scope, entry.getValue(), seen);
                if (key instanceof Number n && n.doubleValue() == n.longValue()) {
                    putProperty(obj, n.longValue(), val);
                } else {
                    putProperty(obj, key.toString(), val);
                }
            }
            return obj;
        }
        if (java instanceof IFunction function) {
            // A function returned from Java (e.g. a closure). It has no context of its own, so it cannot issue
            // main-thread tasks, but it may still yield via MethodResult like any other native method.
            var bridge = new JSMethodBridge(
                (target, context, args) -> function.call(args), function, NO_CONTEXT,
                "function", "a /promises module", false, false
            );
            ScriptRuntime.setFunctionProtoAndParent(bridge, cx, scope);
            return bridge;
        }
        if (java.getClass().isRecord()) {
            var obj = cx.newObject(scope);
            seen.put(java, obj);
            for (var component : java.getClass().getRecordComponents()) {
                Object value;
                try {
                    value = component.getAccessor().invoke(java);
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException("Cannot read record component " + component, e);
                }
                putProperty(obj, component.getName(), toJs(cx, scope, value, seen));
            }
            return obj;
        }
        return JSObjects.wrap(cx, scope, java);
    }

    /**
     * Define an own property directly on a freshly created object. Array-index-like names use Rhino's integer slots
     * (as {@code obj[key]} does), so both {@code obj[1]} and {@code obj["1"]} find the property.
     */
    private static void putProperty(Scriptable obj, String key, @Nullable Object value) {
        var index = arrayIndex(key);
        if (index >= 0) {
            obj.put(index, obj, value);
        } else {
            obj.put(key, obj, value);
        }
    }

    private static void putProperty(Scriptable obj, long key, @Nullable Object value) {
        if (key >= 0 && key <= Integer.MAX_VALUE) {
            obj.put((int) key, obj, value);
        } else {
            obj.put(Long.toString(key), obj, value);
        }
    }

    /** Parse a canonical non-negative integer property name (no sign, no leading zeros), or return -1. */
    private static int arrayIndex(String key) {
        var length = key.length();
        if (length == 0 || length > 10 || (length > 1 && key.charAt(0) == '0')) return -1;
        long value = 0;
        for (var i = 0; i < length; i++) {
            var c = key.charAt(i);
            if (c < '0' || c > '9') return -1;
            value = value * 10 + (c - '0');
        }
        return value <= Integer.MAX_VALUE ? (int) value : -1;
    }

    /**
     * Convert a CC method result array to a single JS return value.
     * Zero results → undefined, one result → that value, two or more → JS Array.
     */
    static Object toJsResult(Context cx, Scriptable scope, @Nullable Object @Nullable [] results) {
        // A MethodResult now carries exactly one value (arrays/collections are themselves single JS-array values),
        // so there is never more than one element to convert.
        if (results == null || results.length == 0) return Undefined.instance;
        var v = toJs(cx, scope, results[0]);
        return v != null ? v : Undefined.instance;
    }

    /**
     * Convert a Rhino JS value to a Java/CC value.
     * <p>
     * JS arrays become an {@link ArrayTable}: a {@link Map} with 1-based {@link Long} keys (the representation Java
     * APIs read list-like tables in, e.g. {@code table.getInt(1)}), which {@link #toJs} turns back into a JS array.
     * Plain objects become a {@link Map} with {@link String} keys (integer-like keys included, as in JS). Only own,
     * enumerable data properties are read: accessor properties are skipped, so no user code runs during conversion.
     * Values that cannot be represented (functions, symbols, {@code undefined}, …) are dropped.
     *
     * @param v The value to convert.
     * @return The converted value.
     * @throws ScriptException If the value contains a cycle or is nested more than {@link #MAX_DEPTH} levels deep.
     */
    static @Nullable Object toJava(@Nullable Object v) throws ScriptException {
        return toJava(v, new IdentityHashMap<>(), 0);
    }

    private static @Nullable Object toJava(@Nullable Object v, IdentityHashMap<Object, Object> seen, int depth) throws ScriptException {
        if (v == null || v instanceof Undefined) return null;
        if (v instanceof Boolean) return v;
        // Handle CharSequence, not just String: Rhino's `+` operator may yield a lazy ConsString.
        if (v instanceof CharSequence) return v.toString();
        if (v instanceof Number n) {
            double d = n.doubleValue();
            long l = (long) d;
            // Note: avoid `d == l ? l : d` — the ternary promotes both branches to double.
            if (d == l) return l;
            return d;
        }
        if (!(v instanceof NativeArray) && !(v instanceof NativeObject)) return null;

        // Shared (non-cyclic) references convert to the same Java object; IN_PROGRESS marks the current path.
        var existing = seen.get(v);
        if (existing == IN_PROGRESS) throw new ScriptException("Cannot serialise recursive object");
        if (existing != null) return existing;
        if (depth >= MAX_DEPTH) throw new ScriptException("Cannot serialise object: nested too deeply");
        seen.put(v, IN_PROGRESS);

        Map<Object, Object> result;
        if (v instanceof NativeArray arr) {
            var length = arr.getLength();
            var table = new ArrayTable(length);
            // Iterate the actual ids rather than 0..length, so sparse arrays with a huge length stay cheap.
            for (var id : arr.getIds()) {
                if (!(id instanceof Integer i) || i < 0 || i >= length || isAccessor(arr, null, i)) continue;
                var val = toJava(arr.get(i, arr), seen, depth + 1);
                if (val != null) table.put((long) i + 1, val);
            }
            result = table;
        } else {
            var obj = (NativeObject) v;
            result = new JSTable();
            for (var id : obj.getIds()) {
                String key;
                Object raw;
                if (id instanceof Integer i) {
                    if (isAccessor(obj, null, i)) continue;
                    key = Integer.toString(i);
                    raw = obj.get(i, obj);
                } else if (id instanceof String s) {
                    if (isAccessor(obj, s, 0)) continue;
                    key = s;
                    raw = obj.get(s, obj);
                } else {
                    continue;
                }
                var val = toJava(raw, seen, depth + 1);
                if (val != null) result.put(key, val);
            }
        }

        seen.put(v, result);
        return result;
    }

    /** Whether an own property is an accessor (getter/setter), whose value must not be read. */
    private static boolean isAccessor(ScriptableObject obj, @Nullable String name, int index) {
        var getter = obj.getGetterOrSetter(name, index, false);
        var setter = obj.getGetterOrSetter(name, index, true);
        return (getter != null && getter != Undefined.instance) || (setter != null && setter != Undefined.instance);
    }

    /** Return the CC/Lua type name of a Rhino value (for error messages). */
    static String getType(@Nullable Object v) {
        if (v == null || v instanceof Undefined) return "nil";
        if (v instanceof Boolean) return "boolean";
        if (v instanceof Number) return "number";
        if (v instanceof String) return "string";
        if (v instanceof NativeArray) return "table";
        if (v instanceof Scriptable) return "table";
        return "userdata";
    }
}
