// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.api.lua.IArguments;
import dan200.computercraft.api.lua.LuaException;
import org.jspecify.annotations.Nullable;

/** {@link IArguments} backed by a Rhino Object[] — argument values are converted lazily via {@link JSValues}. */
final class JSArguments implements IArguments {
    private final Object[] args;
    private final int offset;

    JSArguments(Object[] args) {
        this(args, 0);
    }

    private JSArguments(Object[] args, int offset) {
        this.args = args;
        this.offset = offset;
    }

    @Override
    public int count() {
        return args.length - offset;
    }

    @Override
    public @Nullable Object get(int index) throws LuaException {
        if (index < 0 || index >= count()) return null;
        return JSValues.toJava(args[offset + index]);
    }

    @Override
    public String getType(int index) {
        if (index < 0 || index >= count()) return "nil";
        return JSValues.getType(args[offset + index]);
    }

    @Override
    public IArguments drop(int count) {
        if (count < 0) throw new IllegalArgumentException("count cannot be negative");
        if (count == 0) return this;
        return new JSArguments(args, offset + count);
    }
}
