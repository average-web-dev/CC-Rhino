// SPDX-FileCopyrightText: 2017 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.handles;

import dan200.computercraft.api.scripting.Coerced;
import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.filesystem.TrackingCloseable;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.util.Optional;

/**
 * A file handle opened for writing by {@link dan200.computercraft.core.apis.FSAPI#open}.
 *
 * @cc.module fs.WriteHandle
 */
public class WriteHandle extends AbstractHandle {
    protected WriteHandle(SeekableByteChannel channel, TrackingCloseable closeable, boolean binary) {
        super(channel, closeable, binary);
    }

    public static WriteHandle of(SeekableByteChannel channel, TrackingCloseable closeable, boolean binary, boolean canSeek) {
        return canSeek ? new Seekable(channel, closeable, binary) : new WriteHandle(channel, closeable, binary);
    }

    /**
     * {@inheritDoc}
     *
     * @cc-r.params {@code text: string | number}
     */
    @Override
    @ScriptFunction
    public final void write(IArguments arguments) throws ScriptException {
        super.write(arguments);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @ScriptFunction
    public final void writeLine(Coerced<ByteBuffer> text) throws ScriptException {
        super.writeLine(text);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @ScriptFunction
    public final void flush() throws ScriptException {
        super.flush();
    }

    public static class Seekable extends WriteHandle {
        Seekable(SeekableByteChannel channel, TrackingCloseable closeable, boolean binary) {
            super(channel, closeable, binary);
        }

        /**
         * {@inheritDoc}
         */
        @Override
        @ScriptFunction
        public final @Nullable Object seek(Optional<String> whence, Optional<Long> offset) throws ScriptException {
            return super.seek(whence, offset);
        }
    }
}
