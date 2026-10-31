// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.tty;

import dan200.computercraft.api.scripting.ICallback;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.tty.Pipe;
import org.jspecify.annotations.Nullable;

import java.util.function.Consumer;

/**
 * One direction of a TTY ({@code stdin}, {@code stdout} or {@code stderr}), as seen by scripts.
 * <p>
 * The engine-internal side of the ROM's {@code tty} streams: it reads and writes plain strings, and {@code read()}
 * blocks until data arrives.
 *
 * @cc.module internal/pty.Pipe
 */
public final class PipeHandle {
    private final Consumer<Record> queue;
    private final Pipe pipe;
    private final Consumer<String> writer;

    /**
     * @param queue  Queues an event on the computer reading this pipe, to wake it when data arrives.
     * @param pipe   The pipe.
     * @param writer Where writes go: the pipe itself, or the line discipline for a TTY's {@code stdin}.
     */
    PipeHandle(Consumer<Record> queue, Pipe pipe, Consumer<String> writer) {
        this.queue = queue;
        this.pipe = pipe;
        this.writer = writer;
    }

    /**
     * The id of this pipe, as carried by the {@code pipe_data} and {@code pipe_readable} events.
     *
     * @return The id.
     */
    @ScriptFunction
    public int getId() {
        return pipe.id();
    }

    /**
     * Wait until data is available and return it: everything buffered up to the next end of input.
     *
     * @return The text, or {@code undefined} at end of input (Ctrl+D on an empty line, or the pipe was closed).
     * @cc-r.return string | undefined
     */
    @ScriptFunction
    public MethodResult read() {
        return new ReadCallback().next();
    }

    /**
     * Return what can be read now, without waiting.
     *
     * @return The text ({@code ""} if nothing is buffered), or {@code undefined} at end of input.
     * @cc-r.return string | undefined
     */
    @ScriptFunction
    public @Nullable String tryRead() {
        return pipe.read().data();
    }

    /**
     * Write text. For a TTY's {@code stdin}, the text passes the line discipline as if it were typed.
     *
     * @param data The text.
     */
    @ScriptFunction
    public void write(String data) {
        writer.accept(data);
    }

    /**
     * Start or stop pushing what becomes readable as {@code pipe_data} events (data, or {@code null} at end of input)
     * to this computer, instead of keeping it for {@link #read()}. Buffered data is pushed at once.
     *
     * @param flowing Whether to push.
     */
    @ScriptFunction
    public void setFlowing(boolean flowing) {
        pipe.setFlow(flowing ? read -> queue.accept(new CoreEvents.PipeData(pipe.id(), read.data())) : null);
    }

    /**
     * Whether data is pushed as {@code pipe_data} events.
     *
     * @return Whether the pipe flows.
     */
    @ScriptFunction
    public boolean isFlowing() {
        return pipe.isFlowing();
    }

    /** Close the pipe: readers get end of input once the buffered data is read. */
    @ScriptFunction
    public void end() {
        pipe.end();
    }

    /**
     * Whether the pipe was closed with {@link #end()}.
     *
     * @return Whether it is closed.
     */
    @ScriptFunction
    public boolean isEnded() {
        return pipe.isEnded();
    }

    /**
     * The number of characters waiting to be read.
     *
     * @return The number of buffered characters.
     */
    @ScriptFunction
    public int getBuffered() {
        return pipe.buffered();
    }

    private final class ReadCallback implements ICallback {
        private final MethodResult pull = MethodResult.pullEvent("pipe_readable", this);

        MethodResult next() {
            while (true) {
                var read = pipe.read();
                if (!read.isEmpty()) return MethodResult.of(read.data());
                if (pipe.await(() -> queue.accept(new CoreEvents.PipeReadable(pipe.id())))) return pull;
            }
        }

        @Override
        public MethodResult resume(@Nullable Object[] response) {
            if (response.length < 2 || !(response[1] instanceof Number id) || id.intValue() != pipe.id()) return pull;
            return next();
        }
    }
}
