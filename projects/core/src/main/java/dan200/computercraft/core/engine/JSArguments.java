// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.ScriptException;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Callable;

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
    public @Nullable Object get(int index) throws ScriptException {
        if (index < 0 || index >= count()) return null;
        var raw = args[offset + index];
        // Preserve Rhino Callable (functions, arrow functions) so callers can instanceof-check them.
        // toJava() converts anything it doesn't recognise to null, which would silently drop callbacks.
        if (raw instanceof Callable) return raw;
        return JSValues.toJava(raw);
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
