// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Value;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Bidirectional Java ↔ GraalJS value conversions for the JS machine.
 */
final class JSValues {
    private JSValues() {}

    /**
     * Convert a Java object (as returned by CC APIs) to a GraalJS {@link Value}.
     * Handles cycles via an identity map so recursive structures don't stack-overflow.
     */
    static Value toJs(Context ctx, @Nullable Object obj) {
        return toJs(ctx, obj, null);
    }

    private static Value toJs(Context ctx, @Nullable Object obj, @Nullable IdentityHashMap<Object, Value> seen) {
        if (obj == null) return ctx.asValue(null);
        if (obj instanceof Boolean || obj instanceof Number || obj instanceof String) return ctx.asValue(obj);

        // Binary data — encode as a JS string where each character is a raw byte (0-255).
        // This mirrors CC-Lua's binary string representation.
        if (obj instanceof byte[] bytes) {
            var sb = new StringBuilder(bytes.length);
            for (byte b : bytes) sb.append((char) (b & 0xFF));
            return ctx.asValue(sb.toString());
        }
        if (obj instanceof ByteBuffer buf) {
            var sb = new StringBuilder(buf.remaining());
            var pos = buf.position();
            while (buf.hasRemaining()) sb.append((char) (buf.get() & 0xFF));
            buf.position(pos); // restore position (non-destructive read)
            return ctx.asValue(sb.toString());
        }

        // Complex objects — guard against cycles
        if (seen == null) seen = new IdentityHashMap<>(4);
        var cached = seen.get(obj);
        if (cached != null) return cached;

        if (obj instanceof Object[] arr) {
            var jsArr = ctx.eval("js", "[]");
            seen.put(obj, jsArr);
            for (int i = 0; i < arr.length; i++) jsArr.setArrayElement(i, toJs(ctx, arr[i], seen));
            return jsArr;
        }

        if (obj instanceof Collection<?> col) {
            var jsArr = ctx.eval("js", "[]");
            seen.put(obj, jsArr);
            int i = 0;
            for (var item : col) jsArr.setArrayElement(i++, toJs(ctx, item, seen));
            return jsArr;
        }

        if (obj instanceof Map<?, ?> map) {
            var jsObj = ctx.eval("js", "({})");
            seen.put(obj, jsObj);
            final var seenFinal = seen;
            map.forEach((k, v) -> {
                if (k != null) jsObj.putMember(k.toString(), toJs(ctx, v, seenFinal));
            });
            return jsObj;
        }

        // Unknown — let polyglot decide (will appear as a host object in JS)
        return ctx.asValue(obj);
    }

    /**
     * Convert a GraalJS {@link Value} back to a Java object suitable for CC API return values.
     * Cycles are guarded by an identity map.
     */
    static @Nullable Object toJava(Value v) {
        return toJava(v, null);
    }

    static @Nullable Object toJava(Value v, @Nullable IdentityHashMap<Value, Object> seen) {
        if (v.isNull()) return null;
        if (v.isBoolean()) return v.asBoolean();
        if (v.isNumber()) return v.asDouble();
        if (v.isString()) return v.asString();

        if (seen == null) seen = new IdentityHashMap<>(4);
        var cached = seen.get(v);
        if (cached != null) return cached;

        if (v.hasArrayElements()) {
            var size = (int) v.getArraySize();
            var arr = new Object[size];
            seen.put(v, arr);
            for (int i = 0; i < size; i++) arr[i] = toJava(v.getArrayElement(i), seen);
            return arr;
        }

        if (v.hasMembers()) {
            Map<Object, Object> map = new LinkedHashMap<>();
            seen.put(v, map);
            for (var key : v.getMemberKeys()) {
                var val = toJava(v.getMember(key), seen);
                if (val != null) map.put(key, val);
            }
            return map;
        }

        return null;
    }

    /**
     * Wraps a {@link @Nullable Object}{@code []} result from a {@link dan200.computercraft.api.lua.MethodResult}
     * into a single GraalJS value:
     * <ul>
     *   <li>0 values → JS {@code null}</li>
     *   <li>1 value  → the value directly</li>
     *   <li>N values → a JS array</li>
     * </ul>
     */
    static Value resultToJs(Context ctx, @Nullable Object @Nullable [] vals) {
        if (vals == null || vals.length == 0) return ctx.asValue(null);
        if (vals.length == 1) return toJs(ctx, vals[0]);
        var arr = ctx.eval("js", "[]");
        for (int i = 0; i < vals.length; i++) arr.setArrayElement(i, toJs(ctx, vals[i]));
        return arr;
    }
}
