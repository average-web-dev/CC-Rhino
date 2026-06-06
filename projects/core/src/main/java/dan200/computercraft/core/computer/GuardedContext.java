// SPDX-FileCopyrightText: 2023 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptTask;

/**
 * A {@link IContext} which checks if context is valid when before executing
 * {@linkplain #issueMainThreadTask(ScriptTask) main-thread tasks}.
 */
public final class GuardedContext implements IContext {
    private final IContext original;
    private final Guard guard;

    public GuardedContext(IContext original, Guard guard) {
        this.original = original;
        this.guard = guard;
    }

    /**
     * Determine if this {@link GuardedContext} wraps another context.
     * <p>
     * This may be used to avoid constructing new guarded contexts, in a pattern something like:
     *
     * <pre>{@code
     * var contextWrapper = this.contextWrapper;
     * if(contextWrapper == null || !contextWrapper.wraps(context)) {
     *     contextWrapper = this.contextWrapper = new GuardedContext(context, this);
     * }
     * }</pre>
     *
     * @param context The original context.
     * @return Whether {@code this} wraps {@code context}.
     */
    public boolean wraps(IContext context) {
        return original == context;
    }

    @Override
    public long issueMainThreadTask(ScriptTask task) throws ScriptException {
        return original.issueMainThreadTask(() -> guard.checkValid() ? task.execute() : null);
    }

    /**
     * The function which checks if the context is still valid.
     */
    @FunctionalInterface
    public interface Guard {
        boolean checkValid();
    }
}
