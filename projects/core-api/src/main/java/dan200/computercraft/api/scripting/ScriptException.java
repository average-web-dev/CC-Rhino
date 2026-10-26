// Copyright Daniel Ratcliffe, 2011-2022. This API may be redistributed unmodified and in full only.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.api.scripting;

import org.jspecify.annotations.Nullable;

import java.io.Serial;
import java.util.Map;

/**
 * An exception representing an error in Lua, like that raised by the {@code error()} function.
 */
public class ScriptException extends Exception {
    @Serial
    private static final long serialVersionUID = -6136063076818512651L;
    private final boolean hasLevel;
    private final int level;
    @SuppressWarnings("serial") // Map.copyOf is serializable; the values are plain strings/numbers/booleans.
    private final Map<String, Object> properties;

    public ScriptException(@Nullable String message) {
        super(message);
        hasLevel = false;
        level = 1;
        properties = Map.of();
    }

    public ScriptException(@Nullable String message, int level) {
        super(message);
        hasLevel = true;
        this.level = level;
        properties = Map.of();
    }

    /**
     * Construct an exception whose script-side error object carries additional properties, such as a Node-style
     * {@code code} ({@code "ENOENT"}) or {@code path}.
     *
     * @param message    The error message.
     * @param properties Extra properties to set on the error object. Values should be strings, numbers or booleans.
     */
    public ScriptException(@Nullable String message, Map<String, ?> properties) {
        super(message);
        hasLevel = false;
        level = 1;
        this.properties = Map.copyOf(properties);
    }

    /**
     * Additional properties to set on the error object raised in the script, e.g. {@code code} and {@code path}.
     *
     * @return The extra properties, possibly empty.
     */
    public Map<String, Object> getProperties() {
        return properties;
    }

    /**
     * Whether a level was explicitly specified when constructing. If a level is not provided, the Lua runtime may
     * attempt to pick the most suitable one.
     *
     * @return Whether this has an explicit level.
     */
    public boolean hasLevel() {
        return hasLevel;
    }

    /**
     * The level this error is raised at. Level 1 is the function's caller, level 2 is that function's caller, and so
     * on.
     *
     * @return The level to raise the error at.
     */
    public int getLevel() {
        return level;
    }
}
