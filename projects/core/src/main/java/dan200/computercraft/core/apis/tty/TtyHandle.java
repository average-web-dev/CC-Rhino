// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.tty;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.tty.Tty;
import org.jspecify.annotations.Nullable;

import java.util.function.Consumer;

/**
 * A TTY as seen by scripts: its three pipes, its mode and its size.
 * <p>
 * The engine-internal side of the ROM's {@code tty} module; programs use the Node-style streams built on top of it.
 *
 * @cc.module internal/pty.Tty
 */
public final class TtyHandle {
    private final Consumer<Record> queue;
    private final Tty tty;
    private final PipeHandle stdin;
    private final PipeHandle stdout;
    private final PipeHandle stderr;
    private final boolean resizable;

    /**
     * @param queue     Queues an event on the computer using this TTY (to wake blocked reads).
     * @param tty       The TTY.
     * @param resizable Whether scripts may change the size (a virtual TTY), or the device decides it.
     */
    public TtyHandle(Consumer<Record> queue, Tty tty, boolean resizable) {
        this.queue = queue;
        this.tty = tty;
        this.resizable = resizable;
        stdin = new PipeHandle(queue, tty.stdin(), tty::input);
        stdout = new PipeHandle(queue, tty.stdout(), tty.stdout()::write);
        stderr = new PipeHandle(queue, tty.stderr(), tty.stderr()::write);
    }

    public Tty tty() {
        return tty;
    }

    /**
     * The id of this TTY.
     *
     * @return The id.
     */
    @ScriptFunction
    public int getId() {
        return tty.id();
    }

    /**
     * What programs read; writing to it is like typing.
     *
     * @return The pipe.
     */
    @ScriptFunction
    public PipeHandle getStdin() {
        return stdin;
    }

    /**
     * What programs write.
     *
     * @return The pipe.
     */
    @ScriptFunction
    public PipeHandle getStdout() {
        return stdout;
    }

    /**
     * What programs write as errors.
     *
     * @return The pipe.
     */
    @ScriptFunction
    public PipeHandle getStderr() {
        return stderr;
    }

    /**
     * Whether the TTY is in raw mode (input is passed through as typed) rather than cooked mode (line editing and
     * echo).
     *
     * @return Whether raw mode is on.
     */
    @ScriptFunction
    public boolean isRaw() {
        return tty.isRaw();
    }

    /**
     * Switch raw mode on or off. A half-typed line is dropped.
     *
     * @param raw Whether to use raw mode.
     */
    @ScriptFunction
    public void setRaw(boolean raw) {
        tty.setRaw(raw);
    }

    /**
     * The size of the TTY.
     *
     * @return The width and height in characters.
     */
    @ScriptFunction
    public TtySize getSize() {
        return new TtySize(tty.columns(), tty.rows());
    }

    /**
     * Whether the device showing this TTY shows colours (virtual TTYs do).
     *
     * @return Whether colours are shown.
     */
    @ScriptFunction
    public boolean isColor() {
        return tty.isColour();
    }

    /**
     * The cursor column of the device showing this TTY.
     *
     * @return The column, starting at 0, or {@code undefined} for a virtual TTY.
     * @cc-r.return number | undefined
     */
    @ScriptFunction
    public @Nullable Integer getCursorColumn() {
        var column = tty.column();
        return column < 0 ? null : column;
    }

    /**
     * Change the size of a virtual TTY. If it changes, a {@code tty_resize} event is queued.
     *
     * @param columns The width in characters.
     * @param rows    The height in characters.
     * @throws ScriptException If the TTY belongs to a device, or the size is not positive.
     */
    @ScriptFunction
    public void setSize(int columns, int rows) throws ScriptException {
        if (!resizable) throw new ScriptException("The size of this TTY is set by its device");
        if (columns < 1 || rows < 1) throw new ScriptException("Size must be positive");
        var changed = tty.columns() != columns || tty.rows() != rows;
        tty.resize(columns, rows);
        if (changed) queue.accept(new CoreEvents.TtyResize(tty.id()));
    }

    /**
     * Whether the size can be changed with {@link #setSize}.
     *
     * @return Whether this is a virtual TTY.
     */
    @ScriptFunction
    public boolean isResizable() {
        return resizable;
    }

    /**
     * The size of a TTY.
     *
     * @param columns The width in characters.
     * @param rows    The height in characters.
     */
    public record TtySize(int columns, int rows) {
    }
}
