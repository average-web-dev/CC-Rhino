// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.core.CoreConfig;
import org.mozilla.javascript.*;

/**
 * Resource limits for the JS runtime that cannot be expressed through {@link Context} settings alone.
 *
 * <p>Rhino has no global string length limit, and the interpreter builds {@code a + b} as a {@link ConsString}
 * directly, so there is no hook for plain concatenation. Instead we replace the built-ins which can amplify a small
 * input into a huge string in a single native call ({@code String.prototype.repeat}, {@code padStart},
 * {@code padEnd}) with versions that reject results longer than {@link CoreConfig#jsMaxStringLength} with a
 * catchable {@code RangeError}. Anything that still manages to request too much memory (e.g. repeated
 * concatenation) is caught as an {@link OutOfMemoryError} by {@link JSMachine#handleEvent} and stops the computer.
 */
final class JSLimits {
    static final String STRING_TOO_LARGE = "string too large";

    private JSLimits() {
    }

    static void install(ScriptableObject scope) {
        var proto = ScriptableObject.getClassPrototype(scope, "String");
        if (proto == null) throw new IllegalStateException("String.prototype is missing");

        define(scope, proto, "repeat", 1, JSLimits::repeat);
        define(scope, proto, "padStart", 1, (cx, s, thisObj, args) -> pad(cx, thisObj, args, "padStart", true));
        define(scope, proto, "padEnd", 1, (cx, s, thisObj, args) -> pad(cx, thisObj, args, "padEnd", false));
    }

    private static void define(Scriptable scope, Scriptable proto, String name, int length, SerializableCallable fn) {
        ScriptableObject.defineProperty(proto, name, new LambdaFunction(scope, name, length, fn), ScriptableObject.DONTENUM);
    }

    private static void checkLength(long length) {
        if (length > CoreConfig.jsMaxStringLength) throw ScriptRuntime.rangeError(STRING_TOO_LARGE);
    }

    private static String toStringCoercible(Context cx, Scriptable thisObj, String name) {
        return ScriptRuntime.toString(ScriptRuntimeES6.requireObjectCoercible(cx, thisObj, "String", name));
    }

    /** {@code String.prototype.repeat(count)}, see ECMA-262 22.1.3.17. */
    private static Object repeat(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
        var str = toStringCoercible(cx, thisObj, "repeat");
        var count = ScriptRuntime.toInteger(args, 0);
        if (count < 0 || count == Double.POSITIVE_INFINITY) throw ScriptRuntime.rangeError("Invalid count value");
        if (count == 0 || str.isEmpty()) return "";

        // count may exceed long range; compare in double space first.
        if (count * str.length() > CoreConfig.jsMaxStringLength) throw ScriptRuntime.rangeError(STRING_TOO_LARGE);
        return str.repeat((int) count);
    }

    /** {@code String.prototype.padStart/padEnd(maxLength, fillString)}, see ECMA-262 22.1.3.16-17. */
    private static Object pad(Context cx, Scriptable thisObj, Object[] args, String name, boolean atStart) {
        var str = toStringCoercible(cx, thisObj, name);
        var maxLength = ScriptRuntime.toLength(args, 0);
        if (maxLength <= str.length()) return str;

        var filler = " ";
        if (args.length >= 2 && !Undefined.isUndefined(args[1])) {
            filler = ScriptRuntime.toString(args[1]);
            if (filler.isEmpty()) return str;
        }

        checkLength(maxLength);

        var fillLength = (int) (maxLength - str.length());
        var out = new StringBuilder((int) maxLength);
        if (!atStart) out.append(str);
        var full = fillLength / filler.length();
        for (var i = 0; i < full; i++) out.append(filler);
        out.append(filler, 0, fillLength - full * filler.length());
        if (atStart) out.append(str);
        return out.toString();
    }
}
