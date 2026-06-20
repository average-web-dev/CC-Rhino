// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.filesystem.MountConstants;
import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.FileSystemException;
import dan200.computercraft.core.metrics.Metrics;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.OpenOption;
import java.util.*;

import dan200.computercraft.core.engine.JSValues;

/**
 * Interact with the computer's filesystem. Modelled on Node.js {@code fs}: every operation
 * comes in a blocking {@code …Sync} variant (throws on error) and a callback variant that
 * calls {@code (err, result)} before returning.
 *
 * <p>Path helpers ({@code join}, {@code basename}, …) live in the separate {@code path} module.
 * File handles ({@code openSync} / {@code open}) are deferred to a later phase.
 *
 * @cc.module fs
 */
public class FSAPI implements IComputerAPI {
    private static final Set<OpenOption> READ_EXTENDED =
        Set.of(java.nio.file.StandardOpenOption.READ, java.nio.file.StandardOpenOption.WRITE);

    private final IAPIEnvironment environment;
    private @Nullable FileSystem fileSystem = null;

    public FSAPI(IAPIEnvironment env) {
        environment = env;
    }

    @Override
    public String[] getNames() {
        return new String[]{ "fs" };
    }

    @Override
    public void startup() {
        fileSystem = environment.getFileSystem();
    }

    @Override
    public void shutdown() {
        fileSystem = null;
    }

    private FileSystem getFileSystem() {
        var fs = fileSystem;
        if (fs == null) throw new IllegalStateException("File system is not mounted");
        return fs;
    }

    // ── Convenience read ──────────────────────────────────────────────────────

    /**
     * Read the entire contents of a file synchronously.
     *
     * @param path     The file path.
     * @param encoding {@code "binary"} / {@code "latin1"} / {@code "ascii"} for raw bytes;
     *                 omit or {@code "utf8"} / {@code "utf-8"} for a text string.
     * @return File contents as a {@code string} (binary data is returned as a byte-per-char string).
     * @cc-r.return string
     * @throws ScriptException If the file cannot be read.
     */
    @ScriptFunction
    public final Object readFileSync(String path, Optional<String> encoding) throws ScriptException {
        var binary = isBinary(encoding.orElse(null));
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            var bytes = doReadBytes(path);
            return binary ? bytes : new String(bytes, StandardCharsets.UTF_8);
        } catch (FileSystemException | IOException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Read the entire contents of a file, calling {@code callback(err, data)} when done.
     * The callback is invoked synchronously (CC filesystem I/O does not block a separate thread).
     *
     * @param args {@code (path, callback)} or {@code (path, encoding, callback)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void readFile(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, [encoding,] callback)");
        var path = args.getString(0);
        String encoding = null;
        Function callback;
        if (args.count() >= 3) {
            encoding = args.getString(1);
            callback = extractCallback(args.get(2));
        } else {
            callback = extractCallback(args.get(1));
        }
        var binary = isBinary(encoding);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            var bytes = doReadBytes(path);
            Object result = binary ? bytes : new String(bytes, StandardCharsets.UTF_8);
            callResult(callback, result);
        } catch (FileSystemException | IOException e) {
            callError(callback, e.getMessage());
        }
    }

    // ── Convenience write ─────────────────────────────────────────────────────

    /**
     * Write data to a file synchronously, replacing any existing content.
     *
     * @param args {@code (path, data)} or {@code (path, data, encoding)}.
     * @throws ScriptException If the file cannot be written.
     */
    @ScriptFunction
    public final void writeFileSync(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, data[, encoding])");
        var path = args.getString(0);
        var bytes = toBytesFromArg(args.get(1), args.count() > 2 ? args.getString(2) : null);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            doWriteBytes(path, bytes, MountConstants.WRITE_OPTIONS);
        } catch (FileSystemException | IOException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Write data to a file, calling {@code callback(err)} when done.
     *
     * @param args {@code (path, data, callback)} or {@code (path, data, encoding, callback)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void writeFile(IArguments args) throws ScriptException {
        if (args.count() < 3) throw new ScriptException("Expected (path, data, [encoding,] callback)");
        var path = args.getString(0);
        var rawData = args.get(1);
        String encoding = null;
        Function callback;
        if (args.count() >= 4) {
            encoding = args.getString(2);
            callback = extractCallback(args.get(3));
        } else {
            callback = extractCallback(args.get(2));
        }
        var bytes = toBytesFromArg(rawData, encoding);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            doWriteBytes(path, bytes, MountConstants.WRITE_OPTIONS);
            callResult(callback, null);
        } catch (FileSystemException | IOException e) {
            callError(callback, e.getMessage());
        }
    }

    // ── Convenience append ────────────────────────────────────────────────────

    /**
     * Append data to a file synchronously, creating it if it does not exist.
     *
     * @param args {@code (path, data)} or {@code (path, data, encoding)}.
     * @throws ScriptException If the file cannot be written.
     */
    @ScriptFunction
    public final void appendFileSync(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, data[, encoding])");
        var path = args.getString(0);
        var bytes = toBytesFromArg(args.get(1), args.count() > 2 ? args.getString(2) : null);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            doWriteBytes(path, bytes, MountConstants.APPEND_OPTIONS);
        } catch (FileSystemException | IOException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Append data to a file, calling {@code callback(err)} when done.
     *
     * @param args {@code (path, data, callback)} or {@code (path, data, encoding, callback)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void appendFile(IArguments args) throws ScriptException {
        if (args.count() < 3) throw new ScriptException("Expected (path, data, [encoding,] callback)");
        var path = args.getString(0);
        var rawData = args.get(1);
        String encoding = null;
        Function callback;
        if (args.count() >= 4) {
            encoding = args.getString(2);
            callback = extractCallback(args.get(3));
        } else {
            callback = extractCallback(args.get(2));
        }
        var bytes = toBytesFromArg(rawData, encoding);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            doWriteBytes(path, bytes, MountConstants.APPEND_OPTIONS);
            callResult(callback, null);
        } catch (FileSystemException | IOException e) {
            callError(callback, e.getMessage());
        }
    }

    // ── Directory operations ──────────────────────────────────────────────────

    /**
     * Returns a list of entries in the directory at {@code path}.
     *
     * @param path The directory path.
     * @return A list of entry names (not full paths).
     * @throws ScriptException If the path doesn't exist or is not a directory.
     */
    @ScriptFunction
    public final List<String> readdirSync(String path) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return getFileSystem().list(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * List a directory, calling {@code callback(err, entries)} when done.
     *
     * @param path     The directory path.
     * @param callback Called with {@code (err, string[])} .
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void readdir(String path, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            callResult(fn, getFileSystem().list(path));
        } catch (FileSystemException e) {
            callError(fn, e.getMessage());
        }
    }

    /**
     * Create a directory (and any missing parents) at {@code path}.
     *
     * @param path The directory path.
     * @throws ScriptException If the directory could not be created.
     */
    @ScriptFunction
    public final void mkdirSync(String path) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().makeDir(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Create a directory, calling {@code callback(err)} when done.
     * Accepts an optional {@code options} object (ignored; parents are always created).
     *
     * @param args {@code (path, callback)} or {@code (path, options, callback)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void mkdir(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, [options,] callback)");
        var path = args.getString(0);
        var callback = extractCallback(args.get(args.count() - 1));
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().makeDir(path);
            callResult(callback, null);
        } catch (FileSystemException e) {
            callError(callback, e.getMessage());
        }
    }

    // ── File manipulation ─────────────────────────────────────────────────────

    /**
     * Delete a file or directory (and all its contents).
     *
     * @param path The path to delete.
     * @throws ScriptException If the path could not be deleted.
     */
    @ScriptFunction
    public final void rmSync(String path) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().delete(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Delete a file or directory, calling {@code callback(err)} when done.
     * Accepts an optional {@code options} object; {@code {force:true}} suppresses
     * errors for non-existent paths.
     *
     * @param args {@code (path, callback)} or {@code (path, options, callback)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void rm(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, [options,] callback)");
        var path = args.getString(0);
        var callback = extractCallback(args.get(args.count() - 1));
        var force = false;
        if (args.count() >= 3) {
            var opts = args.get(1);
            if (opts instanceof Map<?, ?> map) {
                force = Boolean.TRUE.equals(map.get("force"));
            }
        }
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().delete(path);
            callResult(callback, null);
        } catch (FileSystemException e) {
            if (force) {
                callResult(callback, null);
            } else {
                callError(callback, e.getMessage());
            }
        }
    }

    /**
     * Move/rename a file or directory.
     *
     * @param src  Source path.
     * @param dest Destination path.
     * @throws ScriptException If the operation fails.
     */
    @ScriptFunction
    public final void renameSync(String src, String dest) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().move(src, dest);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Move/rename a file or directory, calling {@code callback(err)} when done.
     *
     * @param src      Source path.
     * @param dest     Destination path.
     * @param callback Called with {@code (err)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void rename(String src, String dest, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().move(src, dest);
            callResult(fn, null);
        } catch (FileSystemException e) {
            callError(fn, e.getMessage());
        }
    }

    /**
     * Copy a file or directory to {@code dest}. Parent directories are created as needed.
     *
     * @param src  Source path.
     * @param dest Destination path.
     * @throws ScriptException If the copy fails.
     */
    @ScriptFunction
    public final void cpSync(String src, String dest) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().copy(src, dest);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Copy a file or directory, calling {@code callback(err)} when done.
     * Accepts an optional {@code options} object (ignored; copy is always recursive).
     *
     * @param args {@code (src, dest, callback)} or {@code (src, dest, options, callback)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void cp(IArguments args) throws ScriptException {
        if (args.count() < 3) throw new ScriptException("Expected (src, dest, [options,] callback)");
        var src = args.getString(0);
        var dest = args.getString(1);
        var callback = extractCallback(args.get(args.count() - 1));
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().copy(src, dest);
            callResult(callback, null);
        } catch (FileSystemException e) {
            callError(callback, e.getMessage());
        }
    }

    /**
     * Copy a single file to {@code dest}. Delegates to {@link #cpSync} (CC has no file-only copy).
     *
     * @param src  Source file path.
     * @param dest Destination path.
     * @throws ScriptException If the copy fails.
     */
    @ScriptFunction
    public final void copyFileSync(String src, String dest) throws ScriptException {
        cpSync(src, dest);
    }

    /**
     * Copy a single file, calling {@code callback(err)} when done.
     *
     * @param src      Source file path.
     * @param dest     Destination path.
     * @param callback Called with {@code (err)}.
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void copyFile(String src, String dest, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().copy(src, dest);
            callResult(fn, null);
        } catch (FileSystemException e) {
            callError(fn, e.getMessage());
        }
    }

    // ── Querying ──────────────────────────────────────────────────────────────

    /**
     * Returns {@code true} if the path exists.
     *
     * @param path The path to check.
     * @return Whether the path exists.
     */
    @ScriptFunction
    public final boolean existsSync(String path) {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return getFileSystem().exists(path);
        } catch (FileSystemException e) {
            return false;
        }
    }

    /**
     * Returns a {@link Stats}-shaped object for the given path.
     * Fields: {@code size}, {@code mtimeMs}, {@code ctimeMs}, {@code birthtimeMs},
     * {@code isDirectory} (boolean), {@code isFile} (boolean), {@code isReadOnly} (boolean).
     *
     * @param path The path to stat.
     * @return The stats object.
     * @throws ScriptException If the path does not exist.
     */
    @ScriptFunction
    public final Stats statSync(String path) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return buildStats(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Stat a path, calling {@code callback(err, stats)} when done.
     *
     * @param path     The path to stat.
     * @param callback Called with {@code (err, Stats)}.
     * @cc-r.param callback {@code (err: string | null, stats: Stats) => void}
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void stat(String path, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            callResult(fn, buildStats(path));
        } catch (FileSystemException e) {
            callError(fn, e.getMessage());
        }
    }

    /**
     * Resolve and normalise a path (removes {@code .} and {@code ..} components).
     * CC has no symlinks, so this is purely lexical.
     *
     * @param path The path to normalise.
     * @return The normalised absolute path.
     */
    @ScriptFunction
    public final String realpathSync(String path) {
        return FileSystem.sanitizePath(path, true);
    }

    // ── CC-specific extensions (no Node equivalent) ───────────────────────────

    /**
     * Returns the name of the mount a path lives on (e.g. {@code "hdd"}, {@code "rom"}),
     * or {@code null} if the path does not exist.
     *
     * @param path The path to query.
     * @return The mount name, or {@code null}.
     * @throws ScriptException If the path cannot be resolved.
     */
    @ScriptFunction
    public final @Nullable String getDrive(String path) throws ScriptException {
        try {
            return getFileSystem().exists(path) ? getFileSystem().getMountLabel(path) : null;
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Returns the free space on the mount a path lives on, in bytes, or {@code "unlimited"}.
     *
     * @param path The path to query.
     * @return Free bytes, or {@code "unlimited"}.
     * @cc-r.return number | "unlimited"
     * @throws ScriptException If the path does not exist.
     */
    @ScriptFunction
    public final Object getFreeSpace(String path) throws ScriptException {
        try {
            var freeSpace = getFileSystem().getFreeSpace(path);
            return freeSpace >= 0 ? freeSpace : "unlimited";
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Returns the total capacity of the mount a path lives on, in bytes,
     * or {@code null} for read-only mounts (ROM, treasure disks).
     *
     * @param path The path to query.
     * @return Capacity in bytes, or {@code null}.
     * @throws ScriptException If the path cannot be resolved.
     */
    @Nullable
    @ScriptFunction
    public final Object getCapacity(String path) throws ScriptException {
        try {
            var capacity = getFileSystem().getCapacity(path);
            return capacity.isPresent() ? capacity.getAsLong() : null;
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    /**
     * Returns {@code true} if the path lives on a read-only mount.
     *
     * @param path The path to check.
     * @return Whether the path is read-only.
     */
    @ScriptFunction
    public final boolean isReadOnly(String path) {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return getFileSystem().isReadOnly(path);
        } catch (FileSystemException e) {
            return false;
        }
    }

    // open / openSync: deferred — file handles require a dedicated bridge phase.

    // ── Private helpers ───────────────────────────────────────────────────────

    private byte[] doReadBytes(String path) throws FileSystemException, IOException {
        var wrapper = getFileSystem().openForRead(path);
        try (wrapper) {
            var channel = wrapper.get();
            int expectedSize;
            try { expectedSize = Math.max(32, (int) channel.size()); } catch (IOException e) { expectedSize = 32; }
            var stream = new ByteArrayOutputStream(expectedSize);
            var buf = ByteBuffer.allocate(8192);
            while (channel.read(buf) != -1) {
                buf.flip();
                stream.write(buf.array(), 0, buf.limit());
                buf.clear();
            }
            return stream.toByteArray();
        }
    }

    private void doWriteBytes(String path, byte[] bytes, Set<OpenOption> options)
            throws FileSystemException, IOException {
        var wrapper = getFileSystem().openForWrite(path, options);
        try (wrapper) {
            var buf = ByteBuffer.wrap(bytes);
            var channel = wrapper.get();
            while (buf.hasRemaining()) channel.write(buf);
        }
    }

    /**
     * Node-style {@code fs.Stats} for a path; times are epoch milliseconds.
     *
     * @cc-r.interface
     */
    public record Stats(
        long size, long mtimeMs, long ctimeMs, long birthtimeMs,
        boolean isDirectory, boolean isFile, boolean isReadOnly
    ) {
    }

    private Stats buildStats(String path) throws FileSystemException {
        var attrs = getFileSystem().getAttributes(path);
        var modified = attrs.lastModifiedTime().toMillis();
        return new Stats(
            attrs.isDirectory() ? 0L : attrs.size(),
            modified,
            modified,
            attrs.creationTime().toMillis(),
            attrs.isDirectory(),
            !attrs.isDirectory(),
            getFileSystem().isReadOnly(path));
    }

    private static byte[] toBytesFromArg(@Nullable Object data, @Nullable String encoding) throws ScriptException {
        if (data instanceof byte[] bytes) return bytes;
        Charset charset = isBinary(encoding) ? StandardCharsets.ISO_8859_1 : StandardCharsets.UTF_8;
        if (data instanceof String s) return s.getBytes(charset);
        if (data == null) throw new ScriptException("Expected string or Buffer, got nil");
        return data.toString().getBytes(charset);
    }

    private static boolean isBinary(@Nullable String encoding) {
        if (encoding == null) return false;
        return switch (encoding.toLowerCase(Locale.ROOT)) {
            case "binary", "latin1", "ascii" -> true;
            default -> false;
        };
    }

    private static Function extractCallback(@Nullable Object raw) throws ScriptException {
        if (!(raw instanceof Function fn)) throw new ScriptException("Expected a function");
        return fn;
    }

    private static void callResult(Function fn, @Nullable Object javaResult) {
        var cx = Context.getCurrentContext();
        var scope = fn.getParentScope();
        var jsResult = JSValues.toJs(cx, scope, javaResult);
        fn.call(cx, scope, scope, new Object[]{ null, jsResult });
    }

    private static void callError(Function fn, @Nullable String message) {
        var cx = Context.getCurrentContext();
        var scope = fn.getParentScope();
        var err = cx.newObject(scope, "Error", new Object[]{ message != null ? message : "Unknown error" });
        fn.call(cx, scope, scope, new Object[]{ err, null });
    }
}
