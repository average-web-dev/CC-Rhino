// SPDX-FileCopyrightText: 2018 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.handles;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.filesystem.TrackingCloseable;
import org.jspecify.annotations.Nullable;

import java.nio.channels.SeekableByteChannel;
import java.util.Optional;

/**
 * A file handle opened for reading with {@link dan200.computercraft.core.apis.FSAPI#open(String, String)}.
 *
 * @cc.module fs.ReadHandle
 */
public class ReadHandle extends AbstractHandle {
    public ReadHandle(SeekableByteChannel channel, TrackingCloseable closeable, boolean binary) {
        super(channel, closeable, binary);
    }

    public ReadHandle(SeekableByteChannel channel, boolean binary) {
        this(channel, new TrackingCloseable.Impl(channel), binary);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @ScriptFunction
    public final @Nullable Object read(Optional<Integer> countArg) throws ScriptException {
        return super.read(countArg);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @ScriptFunction
    public final @Nullable String readAll() throws ScriptException {
        return super.readAll();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @ScriptFunction
    public final @Nullable String readLine(Optional<Boolean> withTrailingArg) throws ScriptException {
        return super.readLine(withTrailingArg);
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
