// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.jspecify.annotations.Nullable;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * A teletype: the channel a program talks through, as a pair of directions plus a line discipline.
 * <p>
 * The <em>program side</em> reads {@link #stdin()} and writes {@link #stdout()} / {@link #stderr()}. The <em>device
 * side</em> (a terminal emulator on a screen or monitor, or whoever holds a virtual TTY) feeds typed input through
 * {@link #input(String)}, which passes the {@link LineDiscipline}, and consumes the output, either through a
 * {@linkplain #attach(Consumer) sink} or, for a virtual TTY, by reading {@code stdout}/{@code stderr}.
 * <p>
 * Thread-safe: input arrives on the server thread, programs run on the computer thread.
 */
public final class Tty {
    private static final AtomicInteger NEXT_ID = new AtomicInteger(1);

    private final int id = NEXT_ID.getAndIncrement();
    private final Pipe stdin = new Pipe();
    private final Pipe stdout = new Pipe();
    private final Pipe stderr = new Pipe();
    private final LineDiscipline discipline;

    private int columns;
    private int rows;
    private @Nullable Runnable onInterrupt;
    private @Nullable Runnable onResize;

    /**
     * @param columns The width of the TTY in characters.
     * @param rows    The height of the TTY in lines.
     */
    public Tty(int columns, int rows) {
        if (columns < 1 || rows < 1) throw new IllegalArgumentException("size must be positive");
        this.columns = columns;
        this.rows = rows;
        discipline = new LineDiscipline(stdin, stdout::write, this::interrupt);
    }

    /** The id of this TTY, unique within the server. */
    public int id() {
        return id;
    }

    /** What programs read: typed input, after the line discipline. */
    public Pipe stdin() {
        return stdin;
    }

    /** What programs write. */
    public Pipe stdout() {
        return stdout;
    }

    /** What programs write as errors. */
    public Pipe stderr() {
        return stderr;
    }

    /** Feed typed input (or what a holder of a virtual TTY writes to its stdin) through the line discipline. */
    public synchronized void input(String data) {
        discipline.input(data);
    }

    public synchronized boolean isRaw() {
        return discipline.isRaw();
    }

    public synchronized void setRaw(boolean raw) {
        discipline.setRaw(raw);
    }

    /**
     * Send the output of this TTY to a device instead of buffering it for readers.
     *
     * @param sink Receives everything written to {@code stdout} and {@code stderr}, or {@code null} to detach.
     */
    public void attach(@Nullable Consumer<String> sink) {
        stdout.setSink(sink);
        stderr.setSink(sink);
    }

    public synchronized int columns() {
        return columns;
    }

    public synchronized int rows() {
        return rows;
    }

    public void resize(int columns, int rows) {
        if (columns < 1 || rows < 1) throw new IllegalArgumentException("size must be positive");
        Runnable callback;
        synchronized (this) {
            if (this.columns == columns && this.rows == rows) return;
            this.columns = columns;
            this.rows = rows;
            callback = onResize;
        }
        if (callback != null) callback.run();
    }

    /** Called for Ctrl+C in cooked mode, while the input is processed (so it must not call back into this TTY). */
    public synchronized void setOnInterrupt(@Nullable Runnable onInterrupt) {
        this.onInterrupt = onInterrupt;
    }

    /** Called when the size changes. */
    public synchronized void setOnResize(@Nullable Runnable onResize) {
        this.onResize = onResize;
    }

    private void interrupt() {
        var callback = onInterrupt;
        if (callback != null) callback.run();
    }
}
