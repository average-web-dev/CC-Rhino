// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import org.jspecify.annotations.Nullable;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * One direction of a {@link Tty}: text written at one end, read at the other.
 * <p>
 * Data is buffered until it is read, unless the pipe has a {@linkplain #setSink(Consumer) sink} (a device such as the
 * terminal emulator of a screen), which then receives every write directly. A reader that finds the pipe empty
 * {@linkplain #await(Runnable) registers a callback} and parks until the next write; a pipe may be read from several
 * computers (a monitor's TTY), so each reader brings its own callback.
 * <p>
 * End of input comes in two flavours, as on Unix: an <em>end-of-file mark</em> ({@link #writeEof()}, Ctrl+D on an
 * empty line) is read once as end of input, after which reading continues; {@link #end()} closes the pipe for good.
 * <p>
 * All methods are thread-safe: devices write from the server thread, scripts read on the computer thread.
 */
public final class Pipe {
    private static final Object EOF = new Object();
    private static final AtomicInteger NEXT_ID = new AtomicInteger(1);

    private final int id = NEXT_ID.getAndIncrement();
    private final ArrayDeque<Object> chunks = new ArrayDeque<>();
    private int buffered;
    private boolean ended;
    private final List<Runnable> waiters = new ArrayList<>();
    private @Nullable Consumer<String> sink;
    private @Nullable Consumer<Read> flow;
    private boolean pushing;

    /** The id of this pipe, unique within the server. */
    public int id() {
        return id;
    }

    /** Send every write to {@code sink} instead of buffering it ({@code null}: buffer again). */
    public synchronized void setSink(@Nullable Consumer<String> sink) {
        this.sink = sink;
    }

    /**
     * Push everything that becomes readable to {@code flow} instead of keeping it for {@link #read()}: buffered data at
     * once, later writes as they happen; end of input is pushed as {@link Read#eof()}. {@code null} stops the flow, and
     * data is buffered again (a paused stream).
     */
    public void setFlow(@Nullable Consumer<Read> flow) {
        synchronized (this) {
            this.flow = flow;
        }
        if (flow != null) readable();
    }

    public synchronized boolean isFlowing() {
        return flow != null;
    }

    /** Write {@code data}; writes after {@link #end()} are dropped. */
    public void write(String data) {
        if (data.isEmpty()) return;
        Consumer<String> sink;
        synchronized (this) {
            if (ended) return;
            sink = this.sink;
            if (sink == null) {
                chunks.add(data);
                buffered += data.length();
            }
        }
        if (sink != null) sink.accept(data); else readable();
    }

    /** Mark the end of the current input: the next read returns end of input once. */
    public void writeEof() {
        synchronized (this) {
            if (ended || sink != null) return;
            chunks.add(EOF);
        }
        readable();
    }

    /** Close the pipe: after the buffered data, every read returns end of input. */
    public void end() {
        synchronized (this) {
            if (ended) return;
            ended = true;
        }
        readable();
    }

    public synchronized boolean isEnded() {
        return ended;
    }

    /** The number of characters waiting to be read. */
    public synchronized int buffered() {
        return buffered;
    }

    /**
     * Take what can be read now.
     *
     * @return The buffered text up to the next end-of-file mark; {@link Read#eof()} at an end-of-file mark or once the
     * pipe has ended and is drained; {@link Read#empty()} if there is nothing yet.
     */
    public synchronized Read read() {
        var head = chunks.peek();
        if (head == null) return ended ? Read.END : Read.EMPTY;
        if (head == EOF) {
            chunks.remove();
            return Read.END;
        }

        var out = new StringBuilder();
        while (chunks.peek() instanceof String chunk) {
            chunks.remove();
            out.append(chunk);
        }
        buffered -= out.length();
        return new Read(out.toString());
    }

    /**
     * Ask to be notified once when this pipe becomes readable. Returns {@code false} (and registers nothing) if it is
     * readable already, so the caller should read again instead of waiting.
     *
     * @param notify Called (outside the lock, on the writing thread) after the next write, end-of-file mark or end.
     */
    public synchronized boolean await(Runnable notify) {
        if (!chunks.isEmpty() || ended) return false;
        waiters.add(notify);
        return true;
    }

    /** Something became readable: push it to the flow, or wake the waiting readers. */
    private void readable() {
        synchronized (this) {
            // Only one thread pushes at a time, so pushed data keeps its order; it also picks up what others append.
            if (flow != null && pushing) return;
            pushing = flow != null;
        }
        try {
            while (true) {
                Consumer<Read> flow;
                Read read;
                synchronized (this) {
                    flow = this.flow;
                    if (flow == null) break;
                    read = read();
                    if (read.isEmpty()) return;
                    // Once ended and drained, the end is pushed once; afterwards the pipe stays quiet.
                    if (read.isEof() && ended && chunks.isEmpty()) this.flow = null;
                }
                flow.accept(read);
            }
        } finally {
            synchronized (this) {
                pushing = false;
            }
        }
        notifyReader();
    }

    private void notifyReader() {
        Runnable[] callbacks;
        synchronized (this) {
            if (waiters.isEmpty()) return;
            callbacks = waiters.toArray(new Runnable[0]);
            waiters.clear();
        }
        for (var callback : callbacks) callback.run();
    }

    /**
     * The result of {@link #read()}.
     *
     * @param data The text read, or {@code null} at end of input.
     */
    public record Read(@Nullable String data) {
        static final Read EMPTY = new Read("");
        static final Read END = new Read(null);

        public static Read empty() {
            return EMPTY;
        }

        public static Read eof() {
            return END;
        }

        public boolean isEof() {
            return data == null;
        }

        public boolean isEmpty() {
            return data != null && data.isEmpty();
        }
    }
}
