// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.IArguments;
import dan200.computercraft.api.lua.LuaException;
import dan200.computercraft.api.lua.LuaValues;
import dan200.computercraft.api.lua.ObjectLuaTable;
import org.graalvm.polyglot.Value;
import org.jspecify.annotations.Nullable;

import java.util.Map;

/**
 * {@link IArguments} implementation backed by a GraalJS {@link Value} array.
 * <p>
 * JS values are converted to Java types lazily via {@link JSValues#toJava(Value)}.
 */
final class JSArguments implements IArguments {
    private final Value[] args;
    private final int offset;

    JSArguments(Value[] args) {
        this(args, 0);
    }

    private JSArguments(Value[] args, int offset) {
        this.args = args;
        this.offset = offset;
    }

    @Override
    public int count() {
        return Math.max(0, args.length - offset);
    }

    @Override
    public @Nullable Object get(int index) throws LuaException {
        var i = offset + index;
        if (i < 0 || i >= args.length) return null;
        return JSValues.toJava(args[i]);
    }

    @Override
    public String getType(int index) {
        var i = offset + index;
        if (i < 0 || i >= args.length) return "nil";
        return jsTypeName(args[i]);
    }

    @Override
    public double getDouble(int index) throws LuaException {
        var v = rawArg(index, "number");
        if (!v.isNumber()) throw LuaValues.badArgumentOf(this, index, "number");
        return v.asDouble();
    }

    @Override
    public long getLong(int index) throws LuaException {
        var v = rawArg(index, "number");
        if (!v.isNumber()) throw LuaValues.badArgumentOf(this, index, "number");
        return LuaValues.checkFiniteNum(index, v.asDouble()).longValue();
    }

    @Override
    public dan200.computercraft.api.lua.LuaTable<?, ?> getTableUnsafe(int index) throws LuaException {
        var v = rawArg(index, "table");
        if (!v.hasMembers() && !v.hasArrayElements()) throw LuaValues.badArgumentOf(this, index, "table");
        var converted = JSValues.toJava(v);
        if (!(converted instanceof Map<?, ?> map)) throw LuaValues.badArgumentOf(this, index, "table");
        return new ObjectLuaTable(map);
    }

    @Override
    public IArguments drop(int count) {
        if (count < 0) throw new IllegalArgumentException("count cannot be negative");
        if (count == 0) return this;
        return new JSArguments(args, offset + count);
    }

    /** Value at logical index, throws bad-arg error if out of range or wrong type hint. */
    private Value rawArg(int index, String expectedType) throws LuaException {
        var i = offset + index;
        if (i < 0 || i >= args.length) throw LuaValues.badArgumentOf(this, index, expectedType);
        return args[i];
    }

    private static String jsTypeName(Value v) {
        if (v.isNull()) return "nil";
        if (v.isBoolean()) return "boolean";
        if (v.isNumber()) return "number";
        if (v.isString()) return "string";
        if (v.hasArrayElements() || v.hasMembers()) return "table";
        if (v.canExecute()) return "function";
        return "userdata";
    }
}
