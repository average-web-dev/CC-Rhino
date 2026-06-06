// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.nio.ByteBuffer;
import java.util.Collection;
import java.util.Map;

final class JSValues {
    private JSValues() {}

    /** Convert a Java/CC value to a Rhino JS value. */
    static @Nullable Object toJs(Context cx, Scriptable scope, @Nullable Object java) {
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
        if (java instanceof Object[] arr) {
            var jsArr = cx.newArray(scope, arr.length);
            for (int i = 0; i < arr.length; i++) {
                ScriptableObject.putProperty(jsArr, i, toJs(cx, scope, arr[i]));
            }
            return jsArr;
        }
        if (java instanceof Collection<?> col) {
            var items = col.toArray();
            var jsArr = cx.newArray(scope, items.length);
            for (int i = 0; i < items.length; i++) {
                ScriptableObject.putProperty(jsArr, i, toJs(cx, scope, items[i]));
            }
            return jsArr;
        }
        if (java instanceof Map<?, ?> map) {
            var obj = cx.newObject(scope);
            for (var entry : map.entrySet()) {
                var key = entry.getKey();
                var val = toJs(cx, scope, entry.getValue());
                if (key instanceof Number n) {
                    // Lua uses 1-based integer keys; store as integer property (0-based in JS)
                    ScriptableObject.putProperty(obj, (int) n.longValue(), val);
                } else {
                    ScriptableObject.putProperty(obj, key.toString(), val);
                }
            }
            return obj;
        }
        if (java.getClass().isRecord()) {
            var obj = cx.newObject(scope);
            for (var component : java.getClass().getRecordComponents()) {
                Object value;
                try {
                    value = component.getAccessor().invoke(java);
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException("Cannot read record component " + component, e);
                }
                ScriptableObject.putProperty(obj, component.getName(), toJs(cx, scope, value));
            }
            return obj;
        }
        return null;
    }

    /**
     * Convert a CC method result array to a single JS return value.
     * Zero results → undefined, one result → that value, two or more → JS Array.
     */
    static Object toJsResult(Context cx, Scriptable scope, @Nullable Object @Nullable [] results) {
        if (results == null || results.length == 0) return Undefined.instance;
        if (results.length == 1) {
            var v = toJs(cx, scope, results[0]);
            return v != null ? v : Undefined.instance;
        }
        var arr = cx.newArray(scope, results.length);
        for (int i = 0; i < results.length; i++) {
            ScriptableObject.putProperty(arr, i, toJs(cx, scope, results[i]));
        }
        return arr;
    }

    /** Convert a Rhino JS value to a Java/CC value. */
    static @Nullable Object toJava(@Nullable Object v) {
        if (v == null || v instanceof Undefined) return null;
        if (v instanceof Boolean || v instanceof String) return v;
        if (v instanceof Number n) {
            double d = n.doubleValue();
            long l = (long) d;
            return d == l ? l : d;
        }
        if (v instanceof NativeArray arr) {
            var len = (int) arr.getLength();
            var map = new java.util.LinkedHashMap<Object, Object>(len);
            for (int i = 0; i < len; i++) {
                var elem = toJava(arr.get(i, arr));
                if (elem != null) map.put((long) (i + 1), elem);
            }
            return map;
        }
        if (v instanceof NativeObject obj) {
            var ids = obj.getIds();
            var map = new java.util.LinkedHashMap<Object, Object>(ids.length);
            for (var id : ids) {
                Object key;
                Object raw;
                if (id instanceof Integer i) {
                    key = (long) (i + 1); // convert 0-based integer id to 1-based Lua key
                    raw = obj.get(i, obj);
                } else {
                    key = id.toString();
                    raw = obj.get(id.toString(), obj);
                }
                var val = toJava(raw);
                if (val != null) map.put(key, val);
            }
            return map;
        }
        return null;
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
