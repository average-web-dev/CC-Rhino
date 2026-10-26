// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.filesystem.MountConstants;
import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.engine.JSScheduler;
import dan200.computercraft.core.engine.JSValues;
import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.FileSystemException;
import dan200.computercraft.core.metrics.Metrics;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.ScriptableObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.OpenOption;
import java.util.*;

import static dan200.computercraft.api.filesystem.MountConstants.FILE_EXISTS;
import static dan200.computercraft.api.filesystem.MountConstants.NOT_A_DIRECTORY;
import static dan200.computercraft.api.filesystem.MountConstants.NO_SUCH_FILE;

/**
 * Interact with the computer's filesystem. Modelled on Node.js {@code fs}: every operation
 * comes in a blocking {@code …Sync} variant (throws on error) and a callback variant that
 * calls {@code callback(err, result)} on the next event-loop tick, after the call has returned.
 * Callbacks run like event listeners, so they may use blocking APIs themselves.
 *
 * <p>Path helpers ({@code join}, {@code basename}, …) live in the separate {@code path} module.
 * File handles ({@code openSync} / {@code open}) are deferred to a later phase.
 *
 * @cc.module fs
 */
public class FSAPI implements IComputerAPI {
    private static final String IS_A_DIRECTORY = "Is a directory";

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
        return doReadFile(path, isBinary(encoding.orElse(null)));
    }

    /**
     * Read the entire contents of a file, calling {@code callback(err, data)} on the next tick.
     *
     * @param args {@code (path, callback)} or {@code (path, encoding, callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.params {@code path: string, encodingOrCallback: string | ((err: Error | null, data: string) => void), callback?: (err: Error | null, data: string) => void}
     */
    @ScriptFunction
    public final void readFile(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, [encoding,] callback)");
        var path = args.getString(0);
        var encoding = args.count() >= 3 ? args.getString(1) : null;
        var callback = extractCallback(args.get(args.count() >= 3 ? 2 : 1));
        var binary = isBinary(encoding);
        withCallback(callback, () -> doReadFile(path, binary));
    }

    // ── Convenience write ─────────────────────────────────────────────────────

    /**
     * Write data to a file synchronously, replacing any existing content.
     *
     * @param args {@code (path, data)} or {@code (path, data, encoding)}.
     * @throws ScriptException If the file cannot be written.
     * @cc-r.params {@code path: string, data: string | number[], encoding?: string}
     */
    @ScriptFunction
    public final void writeFileSync(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, data[, encoding])");
        var path = args.getString(0);
        var bytes = toBytesFromArg(args.get(1), args.count() > 2 ? args.getString(2) : null);
        doWriteFile(path, bytes, MountConstants.WRITE_OPTIONS);
    }

    /**
     * Write data to a file, calling {@code callback(err)} on the next tick.
     *
     * @param args {@code (path, data, callback)} or {@code (path, data, encoding, callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.params {@code path: string, data: string | number[], encodingOrCallback: string | ((err: Error | null) => void), callback?: (err: Error | null) => void}
     */
    @ScriptFunction
    public final void writeFile(IArguments args) throws ScriptException {
        writeWithCallback(args, MountConstants.WRITE_OPTIONS);
    }

    // ── Convenience append ────────────────────────────────────────────────────

    /**
     * Append data to a file synchronously, creating it if it does not exist.
     *
     * @param args {@code (path, data)} or {@code (path, data, encoding)}.
     * @throws ScriptException If the file cannot be written.
     * @cc-r.params {@code path: string, data: string | number[], encoding?: string}
     */
    @ScriptFunction
    public final void appendFileSync(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, data[, encoding])");
        var path = args.getString(0);
        var bytes = toBytesFromArg(args.get(1), args.count() > 2 ? args.getString(2) : null);
        doWriteFile(path, bytes, MountConstants.APPEND_OPTIONS);
    }

    /**
     * Append data to a file, calling {@code callback(err)} on the next tick.
     *
     * @param args {@code (path, data, callback)} or {@code (path, data, encoding, callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.params {@code path: string, data: string | number[], encodingOrCallback: string | ((err: Error | null) => void), callback?: (err: Error | null) => void}
     */
    @ScriptFunction
    public final void appendFile(IArguments args) throws ScriptException {
        writeWithCallback(args, MountConstants.APPEND_OPTIONS);
    }

    private void writeWithCallback(IArguments args, Set<OpenOption> options) throws ScriptException {
        if (args.count() < 3) throw new ScriptException("Expected (path, data, [encoding,] callback)");
        var path = args.getString(0);
        var encoding = args.count() >= 4 ? args.getString(2) : null;
        var callback = extractCallback(args.get(args.count() >= 4 ? 3 : 2));
        var bytes = toBytesFromArg(args.get(1), encoding);
        withCallback(callback, () -> {
            doWriteFile(path, bytes, options);
            return null;
        });
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
        return doReaddir(path);
    }

    /**
     * List a directory, calling {@code callback(err, entries)} on the next tick.
     *
     * @param path     The directory path.
     * @param callback Called with {@code (err, string[])} .
     * @throws ScriptException On argument errors.
     * @cc-r.param callback {@code (err: Error | null, entries: string[]) => void}
     */
    @ScriptFunction
    public final void readdir(String path, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        withCallback(fn, () -> doReaddir(path));
    }

    /**
     * Create a directory at {@code path}.
     *
     * <p>Without {@code recursive} the parent must already exist and {@code path} must not. With
     * {@code { recursive: true }} missing parents are created and an existing directory is not an error.
     *
     * @param path    The directory path.
     * @param options {@code { recursive?: boolean }}.
     * @throws ScriptException If the directory could not be created.
     * @cc-r.params {@code path: string, options?: { recursive?: boolean }}
     */
    @ScriptFunction
    public final void mkdirSync(String path, Optional<Map<?, ?>> options) throws ScriptException {
        doMkdir(path, flag(options.orElse(null), "recursive"));
    }

    /**
     * Create a directory, calling {@code callback(err)} on the next tick. See {@link #mkdirSync} for the options.
     *
     * @param args {@code (path, callback)} or {@code (path, options, callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.params {@code path: string, optionsOrCallback: { recursive?: boolean } | ((err: Error | null) => void), callback?: (err: Error | null) => void}
     */
    @ScriptFunction
    public final void mkdir(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, [options,] callback)");
        var path = args.getString(0);
        var options = optionsAt(args, 1);
        var callback = extractCallback(args.get(args.count() - 1));
        var recursive = flag(options, "recursive");
        withCallback(callback, () -> {
            doMkdir(path, recursive);
            return null;
        });
    }

    // ── File manipulation ─────────────────────────────────────────────────────

    /**
     * Delete a file or directory.
     *
     * <p>Directories are only removed with {@code { recursive: true }} (which also deletes their contents).
     * {@code { force: true }} ignores a path that does not exist; other errors are still reported.
     *
     * @param path    The path to delete.
     * @param options {@code { recursive?: boolean, force?: boolean }}.
     * @throws ScriptException If the path could not be deleted.
     * @cc-r.params {@code path: string, options?: { recursive?: boolean, force?: boolean }}
     */
    @ScriptFunction
    public final void rmSync(String path, Optional<Map<?, ?>> options) throws ScriptException {
        var opts = options.orElse(null);
        doRm(path, flag(opts, "recursive"), flag(opts, "force"));
    }

    /**
     * Delete a file or directory, calling {@code callback(err)} on the next tick. See {@link #rmSync} for the
     * options.
     *
     * @param args {@code (path, callback)} or {@code (path, options, callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.params {@code path: string, optionsOrCallback: { recursive?: boolean, force?: boolean } | ((err: Error | null) => void), callback?: (err: Error | null) => void}
     */
    @ScriptFunction
    public final void rm(IArguments args) throws ScriptException {
        if (args.count() < 2) throw new ScriptException("Expected (path, [options,] callback)");
        var path = args.getString(0);
        var options = optionsAt(args, 1);
        var callback = extractCallback(args.get(args.count() - 1));
        var recursive = flag(options, "recursive");
        var force = flag(options, "force");
        withCallback(callback, () -> {
            doRm(path, recursive, force);
            return null;
        });
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
        doRename(src, dest);
    }

    /**
     * Move/rename a file or directory, calling {@code callback(err)} on the next tick.
     *
     * @param src      Source path.
     * @param dest     Destination path.
     * @param callback Called with {@code (err)}.
     * @throws ScriptException On argument errors.
     * @cc-r.param callback {@code (err: Error | null) => void}
     */
    @ScriptFunction
    public final void rename(String src, String dest, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        withCallback(fn, () -> {
            doRename(src, dest);
            return null;
        });
    }

    /**
     * Copy a file or directory to {@code dest}. Parent directories are created as needed.
     *
     * <p>Copying a directory requires {@code { recursive: true }}.
     *
     * @param src     Source path.
     * @param dest    Destination path.
     * @param options {@code { recursive?: boolean }}.
     * @throws ScriptException If the copy fails.
     * @cc-r.params {@code src: string, dest: string, options?: { recursive?: boolean }}
     */
    @ScriptFunction
    public final void cpSync(String src, String dest, Optional<Map<?, ?>> options) throws ScriptException {
        doCopy(src, dest, flag(options.orElse(null), "recursive"));
    }

    /**
     * Copy a file or directory, calling {@code callback(err)} on the next tick. See {@link #cpSync} for the
     * options.
     *
     * @param args {@code (src, dest, callback)} or {@code (src, dest, options, callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.params {@code src: string, dest: string, optionsOrCallback: { recursive?: boolean } | ((err: Error | null) => void), callback?: (err: Error | null) => void}
     */
    @ScriptFunction
    public final void cp(IArguments args) throws ScriptException {
        if (args.count() < 3) throw new ScriptException("Expected (src, dest, [options,] callback)");
        var src = args.getString(0);
        var dest = args.getString(1);
        var options = optionsAt(args, 2);
        var callback = extractCallback(args.get(args.count() - 1));
        var recursive = flag(options, "recursive");
        withCallback(callback, () -> {
            doCopy(src, dest, recursive);
            return null;
        });
    }

    /**
     * Copy a single file to {@code dest}. Fails if {@code src} is a directory.
     *
     * @param src  Source file path.
     * @param dest Destination path.
     * @throws ScriptException If the copy fails.
     */
    @ScriptFunction
    public final void copyFileSync(String src, String dest) throws ScriptException {
        doCopy(src, dest, false);
    }

    /**
     * Copy a single file, calling {@code callback(err)} on the next tick.
     *
     * @param src      Source file path.
     * @param dest     Destination path.
     * @param callback Called with {@code (err)}.
     * @throws ScriptException On argument errors.
     * @cc-r.param callback {@code (err: Error | null) => void}
     */
    @ScriptFunction
    public final void copyFile(String src, String dest, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        withCallback(fn, () -> {
            doCopy(src, dest, false);
            return null;
        });
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
        return doStat(path);
    }

    /**
     * Stat a path, calling {@code callback(err, stats)} on the next tick.
     *
     * @param path     The path to stat.
     * @param callback Called with {@code (err, Stats)}.
     * @cc-r.param callback {@code (err: Error | null, stats: Stats) => void}
     * @throws ScriptException On argument errors.
     */
    @ScriptFunction
    public final void stat(String path, Object callback) throws ScriptException {
        var fn = extractCallback(callback);
        withCallback(fn, () -> doStat(path));
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
     * @cc-r.return {@code number | null}
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

    private static @Nullable Map<?, ?> optionsAt(IArguments args, int index) throws ScriptException {
        // The options object is optional: it is only present when there is another argument (the callback) after it.
        if (args.count() <= index + 1) return null;
        return args.get(index) instanceof Map<?, ?> map ? map : null;
    }

    private static boolean flag(@Nullable Map<?, ?> options, String name) {
        return options != null && Boolean.TRUE.equals(options.get(name));
    }

    /** An error message in the same {@code /path: reason} form as {@link FileSystemException}. */
    private static ScriptException pathError(String path, String reason) {
        return new ScriptException("/" + FileSystem.sanitizePath(path, false) + ": " + reason);
    }

    // ── Operations shared by the sync and callback variants ───────────────────

    private Object doReadFile(String path, boolean binary) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            var bytes = doReadBytes(path);
            return binary ? bytes : new String(bytes, StandardCharsets.UTF_8);
        } catch (FileSystemException | IOException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private void doWriteFile(String path, byte[] bytes, Set<OpenOption> options) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            doWriteBytes(path, bytes, options);
        } catch (FileSystemException | IOException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private List<String> doReaddir(String path) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return getFileSystem().list(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private void doMkdir(String path, boolean recursive) throws ScriptException {
        var fs = getFileSystem();
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            if (!recursive) {
                if (fs.exists(path)) throw pathError(path, FILE_EXISTS);
                var parent = FileSystem.getDirectory(path);
                if (!fs.exists(parent)) throw pathError(parent, NO_SUCH_FILE);
                if (!fs.isDir(parent)) throw pathError(parent, NOT_A_DIRECTORY);
            }
            // makeDir creates missing parents and accepts an existing directory.
            fs.makeDir(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private void doRm(String path, boolean recursive, boolean force) throws ScriptException {
        var fs = getFileSystem();
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            // Mounts silently ignore deleting a missing path, so "not found" has to be detected here.
            if (!fs.exists(path)) {
                if (force) return;
                throw pathError(path, NO_SUCH_FILE);
            }
            if (!recursive && fs.isDir(path)) throw pathError(path, IS_A_DIRECTORY);
            fs.delete(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private void doRename(String src, String dest) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            getFileSystem().move(src, dest);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private void doCopy(String src, String dest, boolean recursive) throws ScriptException {
        var fs = getFileSystem();
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            if (!recursive && fs.isDir(src)) throw pathError(src, IS_A_DIRECTORY);
            fs.copy(src, dest);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    private Stats doStat(String path) throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return buildStats(path);
        } catch (FileSystemException e) {
            throw new ScriptException(e.getMessage());
        }
    }

    // ── Callback delivery ─────────────────────────────────────────────────────

    @FunctionalInterface
    private interface Operation {
        @Nullable
        Object run() throws ScriptException;
    }

    /**
     * Run {@code operation} now and deliver its outcome as {@code callback(err, result)} on the next event-loop
     * tick. Deferring (rather than calling the callback from this Java frame) lets the callback use blocking APIs
     * and guarantees it never runs before the fs call has returned.
     */
    private static void withCallback(Function callback, Operation operation) {
        var cx = Context.getCurrentContext();
        var scope = ScriptableObject.getTopLevelScope(callback);
        Object err = null, result = null;
        try {
            result = JSValues.toJs(cx, scope, operation.run());
        } catch (ScriptException e) {
            var message = e.getMessage();
            err = cx.newObject(scope, "Error", new Object[]{ message != null ? message : "Unknown error" });
        }
        JSScheduler.callLater(callback, err, result);
    }
}
