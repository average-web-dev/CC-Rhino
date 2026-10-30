// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.tty;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.apis.IAPIEnvironment;
import dan200.computercraft.core.tty.Tty;

import java.util.Optional;

/**
 * The engine-internal {@code internal/pty} module: creates virtual TTYs. The ROM's {@code tty} module builds the
 * Node-style API on top of it.
 *
 * @cc.module internal/pty
 */
public class PtyAPI implements IComputerAPI {
    /** The size of a virtual TTY when none is given: the screen of a computer. */
    static final int DEFAULT_COLUMNS = 51;
    static final int DEFAULT_ROWS = 19;

    private final IAPIEnvironment environment;

    public PtyAPI(IAPIEnvironment environment) {
        this.environment = environment;
    }

    @Override
    public String[] getNames() {
        return new String[]{ "internal/pty" };
    }

    /**
     * Create a virtual TTY: not attached to a device, its output is read from {@code stdout}/{@code stderr} and its
     * input written to {@code stdin}.
     *
     * @param columns The width in characters (default 51).
     * @param rows    The height in characters (default 19).
     * @return The new TTY.
     * @throws ScriptException If the size is not positive.
     */
    @ScriptFunction
    public final TtyHandle create(Optional<Integer> columns, Optional<Integer> rows) throws ScriptException {
        var width = columns.orElse(DEFAULT_COLUMNS);
        var height = rows.orElse(DEFAULT_ROWS);
        if (width < 1 || height < 1) throw new ScriptException("Size must be positive");
        return new TtyHandle(environment::queueEvent, new Tty(width, height), true);
    }
}
