// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.FileSystemException;
import org.graalvm.polyglot.io.IOAccess;

import java.io.IOException;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * A GraalJS {@link org.graalvm.polyglot.io.FileSystem} backed by the CC computer's {@link FileSystem}.
 * <p>
 * Enables ES6 {@code import} statements to resolve against the computer's virtual disk.
 * All paths are read-only; writes throw {@link AccessDeniedException}.
 * <p>
 * Build the {@link IOAccess} with {@link #ioAccess(FileSystem)} and pass it to the GraalJS context builder.
 */
final class JSFileSystem implements org.graalvm.polyglot.io.FileSystem {
    private final FileSystem ccFs;

    private JSFileSystem(FileSystem ccFs) {
        this.ccFs = ccFs;
    }

    /** Create an {@link IOAccess} that routes all GraalJS I/O through the given CC filesystem. */
    static IOAccess ioAccess(FileSystem ccFs) {
        return IOAccess.newBuilder()
            .fileSystem(new JSFileSystem(ccFs))
            .build();
    }

    // -------------------------------------------------------------------------
    // Path handling — use standard java.nio.file.Path with "/" as the root
    // -------------------------------------------------------------------------

    @Override
    public Path parsePath(String path) {
        return Path.of(path);
    }

    @Override
    public Path parsePath(URI uri) {
        return Path.of(uri.getPath());
    }

    @Override
    public Path toAbsolutePath(Path path) {
        return path.isAbsolute() ? path : Path.of("/").resolve(path);
    }

    @Override
    public Path toRealPath(Path path, LinkOption... linkOptions) {
        return toAbsolutePath(path).normalize();
    }

    // -------------------------------------------------------------------------
    // CC path conversion: java.nio.file.Path → CC path string
    // CC uses "" for root; paths have no leading slash.
    // -------------------------------------------------------------------------

    private String toCC(Path path) {
        var s = toAbsolutePath(path).normalize().toString().replace('\\', '/');
        // Strip leading slash — CC root is ""
        return s.startsWith("/") ? s.substring(1) : s;
    }

    // -------------------------------------------------------------------------
    // Read operations
    // -------------------------------------------------------------------------

    @Override
    public void checkAccess(Path path, Set<? extends AccessMode> modes, LinkOption... linkOptions) throws IOException {
        if (modes.contains(AccessMode.WRITE) || modes.contains(AccessMode.EXECUTE)) {
            throw new AccessDeniedException(path.toString());
        }
        try {
            if (!ccFs.exists(toCC(path))) throw new NoSuchFileException(path.toString());
        } catch (FileSystemException e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    @Override
    public SeekableByteChannel newByteChannel(Path path, Set<? extends OpenOption> options,
                                               FileAttribute<?>... attrs) throws IOException {
        if (options.contains(StandardOpenOption.WRITE) || options.contains(StandardOpenOption.CREATE)) {
            throw new AccessDeniedException(path.toString());
        }
        try {
            // CC returns a SeekableByteChannel wrapped in a FileSystemWrapper — use .get() to unwrap
            var wrapper = ccFs.openForRead(toCC(path));
            var channel = wrapper.get();

            // Buffer the full content so we can close the CC handle immediately
            var buffers = new ArrayList<ByteBuffer>(4);
            var buf = ByteBuffer.allocate(8192);
            while (channel.read(buf) != -1) {
                buf.flip();
                buffers.add(buf);
                buf = ByteBuffer.allocate(8192);
            }
            wrapper.close();

            int total = buffers.stream().mapToInt(ByteBuffer::remaining).sum();
            var content = ByteBuffer.allocate(total);
            for (var b : buffers) content.put(b);
            content.flip();

            return new BufferedChannel(content);
        } catch (FileSystemException e) {
            throw new NoSuchFileException(path.toString(), null, e.getMessage());
        }
    }

    @Override
    public DirectoryStream<Path> newDirectoryStream(Path dir,
                                                     DirectoryStream.Filter<? super Path> filter) throws IOException {
        try {
            var entries = ccFs.list(toCC(dir));
            var paths = new ArrayList<Path>(entries.size());
            for (var entry : entries) {
                var child = dir.resolve(entry);
                try {
                    if (filter.accept(child)) paths.add(child);
                } catch (IOException ignored) {
                    // skip entries the filter rejects with an error
                }
            }
            return new DirectoryStream<>() {
                @Override public java.util.Iterator<Path> iterator() { return paths.iterator(); }
                @Override public void close() {}
            };
        } catch (FileSystemException e) {
            throw new NotDirectoryException(dir.toString());
        }
    }

    @Override
    public Map<String, Object> readAttributes(Path path, String attributes,
                                               LinkOption... options) throws IOException {
        var ccPath = toCC(path);
        try {
            var exists = ccFs.exists(ccPath);
            var isDir  = exists && ccFs.isDir(ccPath);
            var size   = exists && !isDir ? ccFs.getSize(ccPath) : 0L;

            Map<String, Object> map = new HashMap<>();
            map.put("isRegularFile",    exists && !isDir);
            map.put("isDirectory",      isDir);
            map.put("isSymbolicLink",   false);
            map.put("isOther",          false);
            map.put("size",             size);
            var epoch = FileTime.fromMillis(0);
            map.put("lastModifiedTime", epoch);
            map.put("lastAccessTime",   epoch);
            map.put("creationTime",     epoch);
            return map;
        } catch (FileSystemException e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    // -------------------------------------------------------------------------
    // Write operations — all denied
    // -------------------------------------------------------------------------

    @Override
    public void createDirectory(Path dir, FileAttribute<?>... attrs) throws IOException {
        throw new AccessDeniedException(dir.toString());
    }

    @Override
    public void delete(Path path) throws IOException {
        throw new AccessDeniedException(path.toString());
    }

    // -------------------------------------------------------------------------
    // Separator / MIME helpers
    // -------------------------------------------------------------------------

    @Override
    public String getSeparator() { return "/"; }

    @Override
    public @org.jspecify.annotations.Nullable String getMimeType(Path path) {
        var name = path.toString();
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "application/javascript+module";
        return null;
    }

    // -------------------------------------------------------------------------
    // Buffered in-memory SeekableByteChannel for file contents
    // -------------------------------------------------------------------------

    private static final class BufferedChannel implements SeekableByteChannel {
        private final ByteBuffer buf;
        private boolean open = true;

        BufferedChannel(ByteBuffer buf) { this.buf = buf; }

        @Override
        public int read(ByteBuffer dst) {
            if (!buf.hasRemaining()) return -1;
            int n = Math.min(dst.remaining(), buf.remaining());
            var slice = buf.slice().limit(n);
            dst.put(slice);
            buf.position(buf.position() + n);
            return n;
        }

        @Override public int write(ByteBuffer src) throws IOException { throw new IOException("read-only"); }
        @Override public long position() { return buf.position(); }
        @Override public SeekableByteChannel position(long pos) { buf.position((int) pos); return this; }
        @Override public long size() { return buf.limit(); }
        @Override public SeekableByteChannel truncate(long size) throws IOException { throw new IOException("read-only"); }
        @Override public boolean isOpen() { return open; }
        @Override public void close() { open = false; }
    }
}
