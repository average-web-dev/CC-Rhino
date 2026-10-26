// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.IFunction;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.engine.JSErrors;
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
import java.nio.charset.StandardCharsets;
import java.nio.file.OpenOption;
import java.nio.file.attribute.FileTime;
import java.util.*;

import static dan200.computercraft.api.filesystem.MountConstants.*;

/**
 * Interact with the computer's filesystem. Modelled on — and, where the CC filesystem allows, signature-compatible
 * with — Node.js {@code fs}: every operation comes in a blocking {@code …Sync} variant (throws on error) and a
 * callback variant that calls {@code callback(err, result)} on the next event-loop tick, after the call has returned.
 * Callbacks run like event listeners, so they may use blocking APIs themselves.
 *
 * <p>Errors are {@code Error}s with Node's {@code code} ({@code "ENOENT"}, {@code "EEXIST"}, {@code "ENOTDIR"},
 * {@code "EISDIR"}, {@code "ENOTEMPTY"}, {@code "EROFS"}, …), {@code errno}, {@code syscall} and {@code path}
 * (plus {@code dest} for two-path operations) properties, and messages like
 * {@code "ENOENT: no such file or directory, open '/missing.txt'"}. Paths in errors and results are absolute.
 *
 * <p>Path helpers ({@code join}, {@code basename}, …) live in the separate {@code path} module. File descriptors,
 * streams, permissions, symlinks and watchers have no CC equivalent and are not provided.
 *
 * @cc.module fs
 */
public class FSAPI implements IComputerAPI {
    /** {@code fs.constants}: {@link #accessSync} modes and {@link #copyFileSync} flags. */
    private static final int F_OK = 0, X_OK = 1, W_OK = 2, R_OK = 4;
    private static final int COPYFILE_EXCL = 1, COPYFILE_FICLONE = 2, COPYFILE_FICLONE_FORCE = 4;

    private static final String IS_A_DIRECTORY = "Is a directory";
    /** Limit for recursive directory walks (readdir/cp), well beyond any sensible CC directory depth. */
    private static final int MAX_DEPTH = 128;

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
    public Map<String, ?> getConstants() {
        var constants = Map.of(
            "F_OK", F_OK, "R_OK", R_OK, "W_OK", W_OK, "X_OK", X_OK,
            "COPYFILE_EXCL", COPYFILE_EXCL, "COPYFILE_FICLONE", COPYFILE_FICLONE,
            "COPYFILE_FICLONE_FORCE", COPYFILE_FICLONE_FORCE
        );
        // Node also exposes the access modes directly on `fs` (deprecated there, but common in older code).
        return Map.of("constants", constants, "F_OK", F_OK, "R_OK", R_OK, "W_OK", W_OK, "X_OK", X_OK);
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

    // ── Reading and writing files ─────────────────────────────────────────────

    /**
     * Read the entire contents of a file.
     *
     * <p>{@code options} is an encoding or {@code { encoding?, flag? }}. Encodings: {@code "utf8"} (the default —
     * unlike Node, which returns a {@code Buffer}), {@code "latin1"} / {@code "binary"} / {@code "ascii"} (one char
     * per byte), {@code "base64"} and {@code "hex"}. {@code flag} is accepted but reads always use {@code "r"}.
     *
     * @param args {@code (path, options?)}.
     * @return The file contents.
     * @throws ScriptException If the file cannot be read ({@code ENOENT}, {@code EISDIR}, …).
     * @cc-r.overload {@code (path: string, options?: FsEncoding | FsReadFileOptions | null): string}
     */
    @ScriptFunction
    public final Object readFileSync(IArguments args) throws ScriptException {
        var path = args.getString(0);
        return doReadFile(path, encoding(options(args.get(1)), Encoding.UTF8));
    }

    /**
     * Read the entire contents of a file, calling {@code callback(err, data)} on the next tick. See
     * {@link #readFileSync} for the options.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null, data: string) => void): void}
     * @cc-r.overload {@code (path: string, options: FsEncoding | FsReadFileOptions | null | undefined, callback: (err: FsError | null, data: string) => void): void}
     */
    @ScriptFunction
    public final void readFile(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        var encoding = encoding(options(optionalArg(args, 1)), Encoding.UTF8);
        withCallback(callback, () -> doReadFile(path, encoding));
    }

    /**
     * Write data to a file, replacing it if it already exists.
     *
     * <p>{@code data} is a string (encoded with {@code encoding}, default {@code "utf8"}) or an array of byte values.
     * {@code options} is an encoding or {@code { encoding?, flag?, mode? }}; {@code flag} is one of {@code "w"}
     * (default), {@code "a"}, optionally with {@code "x"} (fail with {@code EEXIST} if the file exists) and/or
     * {@code "+"}; {@code mode} is ignored. As in Node, the parent directory must already exist.
     *
     * @param args {@code (path, data, options?)}.
     * @throws ScriptException If the file cannot be written.
     * @cc-r.overload {@code (path: string, data: string | number[], options?: FsEncoding | FsWriteFileOptions | null): void}
     */
    @ScriptFunction
    public final void writeFileSync(IArguments args) throws ScriptException {
        var write = writeArgs(args, args.count(), false);
        doWriteFile(write.path(), write.data(), write.flag());
    }

    /**
     * Write data to a file, calling {@code callback(err)} on the next tick. See {@link #writeFileSync} for the options.
     *
     * @param args {@code (path, data, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, data: string | number[], callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (path: string, data: string | number[], options: FsEncoding | FsWriteFileOptions | null | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void writeFile(IArguments args) throws ScriptException {
        var callback = callback(args, 2);
        var write = writeArgs(args, args.count() - 1, false);
        withCallback(callback, () -> {
            doWriteFile(write.path(), write.data(), write.flag());
            return null;
        });
    }

    /**
     * Append data to a file, creating it if it does not exist. Takes the same arguments as {@link #writeFileSync},
     * but {@code flag} defaults to {@code "a"}.
     *
     * @param args {@code (path, data, options?)}.
     * @throws ScriptException If the file cannot be written.
     * @cc-r.overload {@code (path: string, data: string | number[], options?: FsEncoding | FsWriteFileOptions | null): void}
     */
    @ScriptFunction
    public final void appendFileSync(IArguments args) throws ScriptException {
        var write = writeArgs(args, args.count(), true);
        doWriteFile(write.path(), write.data(), write.flag());
    }

    /**
     * Append data to a file, calling {@code callback(err)} on the next tick. See {@link #appendFileSync}.
     *
     * @param args {@code (path, data, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, data: string | number[], callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (path: string, data: string | number[], options: FsEncoding | FsWriteFileOptions | null | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void appendFile(IArguments args) throws ScriptException {
        var callback = callback(args, 2);
        var write = writeArgs(args, args.count() - 1, true);
        withCallback(callback, () -> {
            doWriteFile(write.path(), write.data(), write.flag());
            return null;
        });
    }

    // ── Directories ───────────────────────────────────────────────────────────

    /**
     * List the entries of a directory.
     *
     * <p>{@code options} is an encoding (ignored) or {@code { withFileTypes?, recursive?, encoding? }}. With
     * {@code withFileTypes} the result is a list of {@code Dirent}s ({@code name}, {@code parentPath},
     * {@code isFile()}, {@code isDirectory()}, …) instead of names. With {@code recursive} the contents of
     * subdirectories are included, as paths relative to {@code path}.
     *
     * @param args {@code (path, options?)}.
     * @return The entry names, or {@code Dirent}s.
     * @throws ScriptException If the path doesn't exist ({@code ENOENT}) or is not a directory ({@code ENOTDIR}).
     * @cc-r.overload {@code (path: string, options: FsReaddirOptions & { withFileTypes: true }): FsDirent[]}
     * @cc-r.overload {@code (path: string, options?: FsEncoding | FsReaddirOptions | null): string[]}
     */
    @ScriptFunction
    public final List<Object> readdirSync(IArguments args) throws ScriptException {
        var path = args.getString(0);
        var options = options(args.get(1));
        return doReaddir(path, flag(options, "withFileTypes", false), flag(options, "recursive", false));
    }

    /**
     * List a directory, calling {@code callback(err, entries)} on the next tick. See {@link #readdirSync}.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, options: FsReaddirOptions & { withFileTypes: true }, callback: (err: FsError | null, entries: FsDirent[]) => void): void}
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null, entries: string[]) => void): void}
     * @cc-r.overload {@code (path: string, options: FsEncoding | FsReaddirOptions | null | undefined, callback: (err: FsError | null, entries: string[]) => void): void}
     */
    @ScriptFunction
    public final void readdir(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        var options = options(optionalArg(args, 1));
        var withFileTypes = flag(options, "withFileTypes", false);
        var recursive = flag(options, "recursive", false);
        withCallback(callback, () -> doReaddir(path, withFileTypes, recursive));
    }

    /**
     * Create a directory.
     *
     * <p>Without {@code recursive} the parent must already exist ({@code ENOENT}) and {@code path} must not
     * ({@code EEXIST}). With {@code { recursive: true }} missing parents are created, an existing directory is not an
     * error, and the first directory created is returned (or {@code undefined} if none was). {@code options} may also
     * be a mode number, which is ignored, as is {@code mode}.
     *
     * @param args {@code (path, options?)}.
     * @return The first directory created when {@code recursive}, otherwise {@code undefined}.
     * @throws ScriptException If the directory could not be created.
     * @cc-r.overload {@code (path: string, options?: number | FsMkdirOptions | null): string | undefined}
     */
    @ScriptFunction
    public final @Nullable String mkdirSync(IArguments args) throws ScriptException {
        var path = args.getString(0);
        return doMkdir(path, flag(options(args.get(1)), "recursive", false));
    }

    /**
     * Create a directory, calling {@code callback(err, path)} on the next tick. See {@link #mkdirSync}.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null, path?: string) => void): void}
     * @cc-r.overload {@code (path: string, options: number | FsMkdirOptions | null | undefined, callback: (err: FsError | null, path?: string) => void): void}
     */
    @ScriptFunction
    public final void mkdir(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        var recursive = flag(options(optionalArg(args, 1)), "recursive", false);
        withCallback(callback, () -> doMkdir(path, recursive));
    }

    /**
     * Remove an empty directory. Fails with {@code ENOTDIR} for files and {@code ENOTEMPTY} if the directory has
     * entries. The deprecated {@code { recursive: true }} behaves like {@link #rmSync} with {@code recursive}.
     *
     * @param args {@code (path, options?)}.
     * @throws ScriptException If the directory could not be removed.
     * @cc-r.overload {@code (path: string, options?: FsRmdirOptions | null): void}
     */
    @ScriptFunction
    public final void rmdirSync(IArguments args) throws ScriptException {
        var path = args.getString(0);
        doRmdir(path, flag(options(args.get(1)), "recursive", false));
    }

    /**
     * Remove an empty directory, calling {@code callback(err)} on the next tick. See {@link #rmdirSync}.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (path: string, options: FsRmdirOptions | null | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void rmdir(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        var recursive = flag(options(optionalArg(args, 1)), "recursive", false);
        withCallback(callback, () -> {
            doRmdir(path, recursive);
            return null;
        });
    }

    // ── Removing, renaming and copying ────────────────────────────────────────

    /**
     * Delete a file or directory.
     *
     * <p>Directories are only removed with {@code { recursive: true }} (which also deletes their contents), otherwise
     * this fails with {@code EISDIR}. {@code { force: true }} ignores a path that does not exist; other errors are
     * still reported.
     *
     * @param args {@code (path, options?)}.
     * @throws ScriptException If the path could not be deleted.
     * @cc-r.overload {@code (path: string, options?: FsRmOptions | null): void}
     */
    @ScriptFunction
    public final void rmSync(IArguments args) throws ScriptException {
        var path = args.getString(0);
        var options = options(args.get(1));
        doRm(path, flag(options, "recursive", false), flag(options, "force", false));
    }

    /**
     * Delete a file or directory, calling {@code callback(err)} on the next tick. See {@link #rmSync}.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (path: string, options: FsRmOptions | null | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void rm(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        var options = options(optionalArg(args, 1));
        var recursive = flag(options, "recursive", false);
        var force = flag(options, "force", false);
        withCallback(callback, () -> {
            doRm(path, recursive, force);
            return null;
        });
    }

    /**
     * Delete a file. Fails with {@code EISDIR} for directories (use {@link #rmdirSync} or {@link #rmSync}).
     *
     * @param path The file to delete.
     * @throws ScriptException If the file could not be deleted.
     */
    @ScriptFunction
    public final void unlinkSync(String path) throws ScriptException {
        doUnlink(path);
    }

    /**
     * Delete a file, calling {@code callback(err)} on the next tick.
     *
     * @param path     The file to delete.
     * @param callback Called with {@code (err)}.
     * @throws ScriptException On argument errors.
     * @cc-r.param callback {@code (err: FsError | null) => void}
     */
    @ScriptFunction
    public final void unlink(String path, Object callback) throws ScriptException {
        withCallback(callbackFn(callback), () -> {
            doUnlink(path);
            return null;
        });
    }

    /**
     * Rename (move) a file or directory.
     *
     * <p>As in Node, an existing file at {@code dest} is replaced, as is an existing <em>empty</em> directory when
     * {@code src} is a directory. The parent of {@code dest} must exist.
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
     * Rename (move) a file or directory, calling {@code callback(err)} on the next tick. See {@link #renameSync}.
     *
     * @param src      Source path.
     * @param dest     Destination path.
     * @param callback Called with {@code (err)}.
     * @throws ScriptException On argument errors.
     * @cc-r.param callback {@code (err: FsError | null) => void}
     */
    @ScriptFunction
    public final void rename(String src, String dest, Object callback) throws ScriptException {
        withCallback(callbackFn(callback), () -> {
            doRename(src, dest);
            return null;
        });
    }

    /**
     * Copy a single file. An existing {@code dest} file is replaced unless {@code mode} includes
     * {@code fs.constants.COPYFILE_EXCL}, in which case this fails with {@code EEXIST}. The parent of {@code dest}
     * must exist.
     *
     * @param src  Source file path.
     * @param dest Destination path.
     * @param mode Copy flags ({@code COPYFILE_EXCL}; the {@code FICLONE} flags are ignored).
     * @throws ScriptException If the copy fails ({@code EISDIR} if {@code src} is a directory).
     */
    @ScriptFunction
    public final void copyFileSync(String src, String dest, Optional<Integer> mode) throws ScriptException {
        doCopyFile(src, dest, (mode.orElse(0) & COPYFILE_EXCL) != 0);
    }

    /**
     * Copy a single file, calling {@code callback(err)} on the next tick. See {@link #copyFileSync}.
     *
     * @param args {@code (src, dest, [mode,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (src: string, dest: string, callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (src: string, dest: string, mode: number | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void copyFile(IArguments args) throws ScriptException {
        var callback = callback(args, 2);
        var src = args.getString(0);
        var dest = args.getString(1);
        var exclusive = optionalArg(args, 2) instanceof Number mode && (mode.intValue() & COPYFILE_EXCL) != 0;
        withCallback(callback, () -> {
            doCopyFile(src, dest, exclusive);
            return null;
        });
    }

    /**
     * Copy a file or directory tree. Missing parents of {@code dest} are created.
     *
     * <p>Copying a directory requires {@code { recursive: true }} ({@code EISDIR} otherwise); its contents are merged
     * into an existing {@code dest} directory. Existing files are overwritten unless {@code force} is {@code false},
     * in which case they are skipped, or reported as {@code EEXIST} with {@code errorOnExist: true}.
     *
     * @param args {@code (src, dest, options?)}.
     * @throws ScriptException If the copy fails.
     * @cc-r.overload {@code (src: string, dest: string, options?: FsCpOptions | null): void}
     */
    @ScriptFunction
    public final void cpSync(IArguments args) throws ScriptException {
        var src = args.getString(0);
        var dest = args.getString(1);
        doCp(src, dest, cpOptions(options(args.get(2))));
    }

    /**
     * Copy a file or directory tree, calling {@code callback(err)} on the next tick. See {@link #cpSync}.
     *
     * @param args {@code (src, dest, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (src: string, dest: string, callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (src: string, dest: string, options: FsCpOptions | null | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void cp(IArguments args) throws ScriptException {
        var callback = callback(args, 2);
        var src = args.getString(0);
        var dest = args.getString(1);
        var options = cpOptions(options(optionalArg(args, 2)));
        withCallback(callback, () -> {
            doCp(src, dest, options);
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
     * Check whether a path exists, calling {@code callback(exists)} on the next tick. Deprecated in Node (the
     * callback takes no error argument); prefer {@link #existsSync} or {@link #access}.
     *
     * @param path     The path to check.
     * @param callback Called with {@code (exists)}.
     * @throws ScriptException On argument errors.
     * @cc-r.param callback {@code (exists: boolean) => void}
     */
    @ScriptFunction
    public final void exists(String path, Object callback) throws ScriptException {
        JSScheduler.callLater(callbackFn(callback), existsSync(path));
    }

    /**
     * Check that a path is accessible. {@code mode} is a combination of {@code fs.constants.F_OK} (exists, the
     * default), {@code R_OK}, {@code W_OK} and {@code X_OK}. Every existing path is readable and executable; it is
     * writable unless it lives on a read-only mount ({@code EROFS}).
     *
     * @param path The path to check.
     * @param mode The accessibility checks to perform.
     * @throws ScriptException If the path is missing ({@code ENOENT}) or not accessible.
     */
    @ScriptFunction
    public final void accessSync(String path, Optional<Integer> mode) throws ScriptException {
        doAccess(path, mode.orElse(F_OK));
    }

    /**
     * Check that a path is accessible, calling {@code callback(err)} on the next tick. See {@link #accessSync}.
     *
     * @param args {@code (path, [mode,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null) => void): void}
     * @cc-r.overload {@code (path: string, mode: number | undefined, callback: (err: FsError | null) => void): void}
     */
    @ScriptFunction
    public final void access(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        var mode = optionalArg(args, 1) instanceof Number n ? n.intValue() : F_OK;
        withCallback(callback, () -> {
            doAccess(path, mode);
            return null;
        });
    }

    /**
     * Returns a Node-style {@code Stats} object for a path.
     *
     * <p>It has {@code size}, {@code mode}, {@code mtimeMs} / {@code atimeMs} / {@code ctimeMs} /
     * {@code birthtimeMs}, the methods {@code isFile()}, {@code isDirectory()}, {@code isSymbolicLink()} etc., and
     * the CC extension {@code readOnly}. There are no {@code Date} fields; use {@code new Date(stats.mtimeMs)}.
     *
     * <p>{@code lstatSync} is an alias, as CC has no symlinks. With {@code { throwIfNoEntry: false }} a missing path
     * returns {@code undefined} instead of throwing {@code ENOENT}.
     *
     * @param args {@code (path, options?)}.
     * @return The stats object.
     * @throws ScriptException If the path does not exist.
     * @cc-r.overload {@code (path: string, options: FsStatOptions & { throwIfNoEntry: false }): FsStats | undefined}
     * @cc-r.overload {@code (path: string, options?: FsStatOptions | null): FsStats}
     */
    @ScriptFunction({ "statSync", "lstatSync" })
    public final @Nullable Stats statSync(IArguments args) throws ScriptException {
        var path = args.getString(0);
        return doStat(path, flag(options(args.get(1)), "throwIfNoEntry", true));
    }

    /**
     * Stat a path, calling {@code callback(err, stats)} on the next tick. See {@link #statSync}. {@code lstat} is an
     * alias.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null, stats: FsStats) => void): void}
     * @cc-r.overload {@code (path: string, options: FsStatOptions | null | undefined, callback: (err: FsError | null, stats: FsStats) => void): void}
     */
    @ScriptFunction({ "stat", "lstat" })
    public final void stat(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        withCallback(callback, () -> doStat(path, true));
    }

    /**
     * Resolve a path to its canonical absolute form (removing {@code .}, {@code ..} and duplicate separators).
     * CC has no symlinks, so this is purely lexical, but the path must exist ({@code ENOENT}).
     *
     * @param path The path to resolve.
     * @return The absolute path, e.g. {@code "/rom/programs"}.
     * @throws ScriptException If the path does not exist.
     */
    @ScriptFunction
    public final String realpathSync(String path) throws ScriptException {
        return doRealpath(path);
    }

    /**
     * Resolve a path, calling {@code callback(err, resolved)} on the next tick. See {@link #realpathSync}.
     *
     * @param args {@code (path, [options,] callback)}.
     * @throws ScriptException On argument errors.
     * @cc-r.overload {@code (path: string, callback: (err: FsError | null, resolved: string) => void): void}
     * @cc-r.overload {@code (path: string, options: FsEncoding | { encoding?: FsEncoding | null } | null | undefined, callback: (err: FsError | null, resolved: string) => void): void}
     */
    @ScriptFunction
    public final void realpath(IArguments args) throws ScriptException {
        var callback = callback(args, 1);
        var path = args.getString(0);
        withCallback(callback, () -> doRealpath(path));
    }

    // ── CC-specific extensions (no Node equivalent) ───────────────────────────

    /**
     * CC extension: the name of the mount a path lives on, or {@code null} if the path does not exist.
     *
     * <p>For example {@code "hdd"} or {@code "rom"}.
     *
     * @param path The path to query.
     * @return The mount name, or {@code null}.
     * @throws ScriptException If the path cannot be resolved.
     */
    @ScriptFunction
    public final @Nullable String getDrive(String path) throws ScriptException {
        return fsOp("getDrive", path, null, fs -> fs.exists(path) ? fs.getMountLabel(path) : null);
    }

    /**
     * CC extension: the free space on the mount a path lives on, in bytes, or {@code "unlimited"}.
     *
     * @param path The path to query.
     * @return Free bytes, or {@code "unlimited"}.
     * @cc-r.return number | "unlimited"
     * @throws ScriptException If the path does not exist.
     */
    @ScriptFunction
    public final Object getFreeSpace(String path) throws ScriptException {
        return Objects.requireNonNull(fsOp("getFreeSpace", path, null, fs -> {
            var freeSpace = fs.getFreeSpace(path);
            return freeSpace >= 0 ? freeSpace : "unlimited";
        }));
    }

    /**
     * CC extension: the total capacity of the mount a path lives on, in bytes, or {@code null} for read-only mounts
     * (ROM, treasure disks).
     *
     * @param path The path to query.
     * @return Capacity in bytes, or {@code null}.
     * @throws ScriptException If the path cannot be resolved.
     * @cc-r.return {@code number | null}
     */
    @Nullable
    @ScriptFunction
    public final Object getCapacity(String path) throws ScriptException {
        return fsOp("getCapacity", path, null, fs -> {
            var capacity = fs.getCapacity(path);
            return capacity.isPresent() ? capacity.getAsLong() : null;
        });
    }

    /**
     * CC extension: whether the path lives on a read-only mount.
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

    // open / openSync (file descriptors / handles): deferred — they require a dedicated bridge phase.

    // ── Result types ──────────────────────────────────────────────────────────

    private static final IFunction TRUE = IFunction.nonYielding(args -> MethodResult.of(true));
    private static final IFunction FALSE = IFunction.nonYielding(args -> MethodResult.of(false));

    private static IFunction is(boolean value) {
        return value ? TRUE : FALSE;
    }

    /**
     * Node-style {@code fs.Stats}; times are epoch milliseconds. The {@link IFunction} components become the
     * {@code isFile()}, {@code isDirectory()}, … methods. TypeScript shape: {@code FsStats} (types/fs.d.ts).
     */
    public record Stats(
        int dev, int ino, int mode, int nlink, int uid, int gid, int rdev,
        long size, int blksize, long blocks,
        long atimeMs, long mtimeMs, long ctimeMs, long birthtimeMs,
        boolean readOnly,
        IFunction isFile, IFunction isDirectory, IFunction isSymbolicLink, IFunction isBlockDevice,
        IFunction isCharacterDevice, IFunction isFIFO, IFunction isSocket
    ) {
        static Stats of(boolean directory, long size, long atime, long mtime, long birthtime, boolean readOnly) {
            // S_IFDIR / S_IFREG with rwxr-xr-x / rw-r--r--, minus the write bits on read-only mounts.
            var mode = directory ? 0040755 : 0100644;
            if (readOnly) mode &= ~0222;
            return new Stats(
                0, 0, mode, 1, 0, 0, 0,
                size, 4096, (size + 511) / 512,
                atime, mtime, mtime, birthtime,
                readOnly,
                is(!directory), is(directory), FALSE, FALSE, FALSE, FALSE, FALSE
            );
        }
    }

    /**
     * Node-style {@code fs.Dirent} returned by {@code readdir} with {@code withFileTypes}. TypeScript shape:
     * {@code FsDirent} (types/fs.d.ts).
     */
    public record Dirent(
        String name, String parentPath, String path,
        IFunction isFile, IFunction isDirectory, IFunction isSymbolicLink, IFunction isBlockDevice,
        IFunction isCharacterDevice, IFunction isFIFO, IFunction isSocket
    ) {
        static Dirent of(String name, String parentPath, boolean directory) {
            return new Dirent(name, parentPath, parentPath, is(!directory), is(directory), FALSE, FALSE, FALSE, FALSE, FALSE);
        }
    }

    // ── Node-style errors ─────────────────────────────────────────────────────

    /** The POSIX error codes fs operations report, with Linux errno values and Node's descriptions. */
    private enum ErrorCode {
        EIO(5, "i/o error"),
        ENOENT(2, "no such file or directory"),
        EACCES(13, "permission denied"),
        EEXIST(17, "file already exists"),
        ENOTDIR(20, "not a directory"),
        EISDIR(21, "illegal operation on a directory"),
        EINVAL(22, "invalid argument"),
        EMFILE(24, "too many open files"),
        ENOSPC(28, "no space left on device"),
        EROFS(30, "read-only file system"),
        ENOTEMPTY(39, "directory not empty"),
        ELOOP(40, "too many levels of nesting");

        final int errno;
        final String description;

        ErrorCode(int errno, String description) {
            this.errno = errno;
            this.description = description;
        }
    }

    /** The absolute, normalised form of a path, as used in results and error messages. */
    private static String abs(String path) {
        return "/" + FileSystem.sanitizePath(path, true);
    }

    private static ScriptException fsError(ErrorCode code, String syscall, String path, @Nullable String dest) {
        return fsError(code, code.description, syscall, path, dest);
    }

    /** A Node-style error: {@code "ENOENT: no such file or directory, open '/a'"} with code/errno/syscall/path. */
    private static ScriptException fsError(
        ErrorCode code, String description, String syscall, String path, @Nullable String dest
    ) {
        var message = new StringBuilder()
            .append(code.name()).append(": ").append(description).append(", ").append(syscall)
            .append(" '").append(abs(path)).append('\'');
        var properties = new HashMap<String, Object>();
        properties.put("code", code.name());
        properties.put("errno", -code.errno);
        properties.put("syscall", syscall);
        properties.put("path", abs(path));
        if (dest != null) {
            message.append(" -> '").append(abs(dest)).append('\'');
            properties.put("dest", abs(dest));
        }
        return new ScriptException(message.toString(), properties);
    }

    /** An argument error, with a Node {@code ERR_*} code. */
    private static ScriptException argError(String code, String message) {
        return new ScriptException(message, Map.of("code", code));
    }

    /** Translate a CC filesystem error ({@code "/path: reason"} or {@code "reason"}) into a Node-style error. */
    private ScriptException translate(FileSystemException e, String syscall, String path, @Nullable String dest) {
        var reason = e.getMessage() != null ? e.getMessage() : ACCESS_DENIED;
        var separator = reason.indexOf(": ");
        if (reason.startsWith("/") && separator > 0) reason = reason.substring(separator + 2);

        var code = switch (reason) {
            case NO_SUCH_FILE -> ErrorCode.ENOENT;
            case FILE_EXISTS -> ErrorCode.EEXIST;
            case NOT_A_DIRECTORY -> ErrorCode.ENOTDIR;
            case NOT_A_FILE, CANNOT_WRITE_TO_DIRECTORY, IS_A_DIRECTORY -> ErrorCode.EISDIR;
            case ACCESS_DENIED -> isReadOnly(path) || (dest != null && isReadOnly(dest)) ? ErrorCode.EROFS : ErrorCode.EACCES;
            case OUT_OF_SPACE -> ErrorCode.ENOSPC;
            case "Too many files already open" -> ErrorCode.EMFILE;
            case "Invalid Path", "Can't move a directory inside itself", "Can't copy a directory inside itself" ->
                ErrorCode.EINVAL;
            default -> null;
        };
        return code != null
            ? fsError(code, syscall, path, dest)
            : fsError(ErrorCode.EIO, reason, syscall, path, dest);
    }

    // ── Argument helpers ──────────────────────────────────────────────────────

    /** The trailing callback of a callback variant, which must follow at least {@code required} arguments. */
    private static Function callback(IArguments args, int required) throws ScriptException {
        if (args.count() <= required) {
            throw argError("ERR_INVALID_ARG_TYPE", "The \"cb\" argument must be of type function");
        }
        return callbackFn(args.get(args.count() - 1));
    }

    private static Function callbackFn(@Nullable Object raw) throws ScriptException {
        if (!(raw instanceof Function fn)) {
            throw argError("ERR_INVALID_ARG_TYPE", "The \"cb\" argument must be of type function");
        }
        return fn;
    }

    /** An optional argument of a callback variant: only present if it comes before the trailing callback. */
    private static @Nullable Object optionalArg(IArguments args, int index) throws ScriptException {
        return index < args.count() - 1 ? args.get(index) : null;
    }

    /**
     * Normalise an options argument: {@code null}/{@code undefined} → empty, a string → {@code { encoding }}, a
     * number → {@code { mode }} (as accepted by {@code mkdir}), an object → itself.
     */
    private static Map<?, ?> options(@Nullable Object raw) throws ScriptException {
        if (raw == null) return Map.of();
        if (raw instanceof String encoding) return Map.of("encoding", encoding);
        if (raw instanceof Number mode) return Map.of("mode", mode);
        if (raw instanceof Map<?, ?> map) return map;
        throw argError("ERR_INVALID_ARG_TYPE", "The \"options\" argument must be of type object or string");
    }

    private static boolean flag(Map<?, ?> options, String name, boolean def) {
        var value = options.get(name);
        return value instanceof Boolean b ? b : def;
    }

    private enum Encoding { UTF8, LATIN1, BASE64, HEX }

    private static Encoding encoding(Map<?, ?> options, Encoding def) throws ScriptException {
        var raw = options.get("encoding");
        if (raw == null) return def;
        if (!(raw instanceof String name)) {
            throw argError("ERR_INVALID_ARG_TYPE", "The \"encoding\" option must be of type string");
        }
        return switch (name.toLowerCase(Locale.ROOT)) {
            case "utf8", "utf-8" -> Encoding.UTF8;
            case "latin1", "binary", "ascii" -> Encoding.LATIN1;
            case "base64" -> Encoding.BASE64;
            case "hex" -> Encoding.HEX;
            default -> throw argError("ERR_UNKNOWN_ENCODING", "Unknown encoding: " + name);
        };
    }

    private static Object decode(byte[] bytes, Encoding encoding) {
        return switch (encoding) {
            case UTF8 -> new String(bytes, StandardCharsets.UTF_8);
            case LATIN1 -> bytes; // converted to a one-char-per-byte string
            case BASE64 -> Base64.getEncoder().encodeToString(bytes);
            case HEX -> HexFormat.of().formatHex(bytes);
        };
    }

    private static byte[] encode(@Nullable Object data, Encoding encoding) throws ScriptException {
        if (data instanceof String s) {
            try {
                return switch (encoding) {
                    case UTF8 -> s.getBytes(StandardCharsets.UTF_8);
                    case LATIN1 -> s.getBytes(StandardCharsets.ISO_8859_1);
                    case BASE64 -> Base64.getMimeDecoder().decode(s);
                    case HEX -> HexFormat.of().parseHex(s);
                };
            } catch (IllegalArgumentException e) {
                throw argError("ERR_INVALID_ARG_VALUE", "The \"data\" argument is not valid " + encoding.name().toLowerCase(Locale.ROOT));
            }
        }
        if (data instanceof Map<?, ?> array && isByteArray(array)) {
            var length = 0;
            for (var key : array.keySet()) length = Math.max(length, ((Long) key).intValue());
            var bytes = new byte[length];
            for (var entry : array.entrySet()) {
                bytes[((Long) entry.getKey()).intValue() - 1] = ((Number) entry.getValue()).byteValue();
            }
            return bytes;
        }
        throw argError("ERR_INVALID_ARG_TYPE", "The \"data\" argument must be of type string or an array of bytes");
    }

    /** Whether a converted JS value is an array of numbers (converted arrays have 1-based {@link Long} keys). */
    private static boolean isByteArray(Map<?, ?> map) {
        for (var entry : map.entrySet()) {
            if (!(entry.getKey() instanceof Long key) || key < 1 || key > Integer.MAX_VALUE) return false;
            if (!(entry.getValue() instanceof Number)) return false;
        }
        return true;
    }

    private record WriteFlag(boolean append, boolean exclusive) {
        Set<OpenOption> openOptions() {
            return append ? APPEND_OPTIONS : WRITE_OPTIONS;
        }
    }

    private static WriteFlag writeFlag(@Nullable Object raw, boolean append) throws ScriptException {
        if (raw == null) return new WriteFlag(append, false);
        if (raw instanceof String flag && flag.matches("(w|wx|xw|a|ax|xa|as|sa)\\+?")) {
            return new WriteFlag(flag.indexOf('a') >= 0, flag.indexOf('x') >= 0);
        }
        throw argError("ERR_INVALID_ARG_VALUE", "The value \"" + raw + "\" is not supported for the \"flag\" option");
    }

    private record WriteArgs(String path, byte[] data, WriteFlag flag) {
    }

    /** Parse {@code (path, data, options?)}, where the options (if any) are at index 2 and before {@code end}. */
    private static WriteArgs writeArgs(IArguments args, int end, boolean append) throws ScriptException {
        var path = args.getString(0);
        if (end < 2) throw argError("ERR_INVALID_ARG_TYPE", "The \"data\" argument must be of type string or an array of bytes");
        var options = options(end > 2 ? args.get(2) : null);
        var data = encode(args.get(1), encoding(options, Encoding.UTF8));
        return new WriteArgs(path, data, writeFlag(options.get("flag"), append));
    }

    private record CpOptions(boolean recursive, boolean force, boolean errorOnExist) {
    }

    private static CpOptions cpOptions(Map<?, ?> options) {
        return new CpOptions(
            flag(options, "recursive", false), flag(options, "force", true), flag(options, "errorOnExist", false)
        );
    }

    // ── Operations shared by the sync and callback variants ───────────────────

    @FunctionalInterface
    private interface FsOperation<T> {
        @Nullable
        T run(FileSystem fs) throws FileSystemException, IOException, ScriptException;
    }

    /** Run a filesystem operation, timing it and translating CC filesystem errors into Node-style ones. */
    private <T> @Nullable T fsOp(String syscall, String path, @Nullable String dest, FsOperation<T> operation)
        throws ScriptException {
        try (var ignored = environment.time(Metrics.FS_OPS)) {
            return operation.run(getFileSystem());
        } catch (FileSystemException e) {
            throw translate(e, syscall, path, dest);
        } catch (IOException e) {
            throw fsError(ErrorCode.EIO, FileSystemException.getMessage(e), syscall, path, dest);
        }
    }

    private static boolean samePath(String a, String b) {
        return FileSystem.sanitizePath(a, true).equals(FileSystem.sanitizePath(b, true));
    }

    private static boolean isInside(String parent, String child) {
        var p = FileSystem.sanitizePath(parent, true);
        var c = FileSystem.sanitizePath(child, true);
        return p.isEmpty() ? !c.isEmpty() : c.startsWith(p + "/");
    }

    /** Node does not create missing parents: require the parent of {@code path} to be an existing directory. */
    private static void checkParent(FileSystem fs, String syscall, String path, @Nullable String dest)
        throws FileSystemException, ScriptException {
        var target = dest != null ? dest : path;
        var parent = FileSystem.getDirectory(target);
        if (!fs.exists(parent)) throw fsError(ErrorCode.ENOENT, syscall, path, dest);
        if (!fs.isDir(parent)) throw fsError(ErrorCode.ENOTDIR, syscall, path, dest);
    }

    private Object doReadFile(String path, Encoding encoding) throws ScriptException {
        return Objects.requireNonNull(fsOp("open", path, null, fs -> {
            if (fs.exists(path) && fs.isDir(path)) throw fsError(ErrorCode.EISDIR, "read", path, null);
            try (var wrapper = fs.openForRead(path)) {
                var channel = wrapper.get();
                int expectedSize;
                try {
                    expectedSize = Math.max(32, (int) channel.size());
                } catch (IOException e) {
                    expectedSize = 32;
                }
                var stream = new ByteArrayOutputStream(expectedSize);
                var buf = ByteBuffer.allocate(8192);
                while (channel.read(buf) != -1) {
                    buf.flip();
                    stream.write(buf.array(), 0, buf.limit());
                    buf.clear();
                }
                return decode(stream.toByteArray(), encoding);
            }
        }));
    }

    private void doWriteFile(String path, byte[] bytes, WriteFlag flag) throws ScriptException {
        fsOp("open", path, null, fs -> {
            if (fs.exists(path)) {
                if (fs.isDir(path)) throw fsError(ErrorCode.EISDIR, "open", path, null);
                if (flag.exclusive()) throw fsError(ErrorCode.EEXIST, "open", path, null);
            } else {
                checkParent(fs, "open", path, null);
            }
            try (var wrapper = fs.openForWrite(path, flag.openOptions())) {
                var buf = ByteBuffer.wrap(bytes);
                var channel = wrapper.get();
                while (buf.hasRemaining()) channel.write(buf);
            }
            return null;
        });
    }

    private List<Object> doReaddir(String path, boolean withFileTypes, boolean recursive) throws ScriptException {
        return Objects.requireNonNull(fsOp("scandir", path, null, fs -> {
            if (!fs.exists(path)) throw fsError(ErrorCode.ENOENT, "scandir", path, null);
            if (!fs.isDir(path)) throw fsError(ErrorCode.ENOTDIR, "scandir", path, null);
            var entries = new ArrayList<Object>();
            listInto(fs, FileSystem.sanitizePath(path, true), "", withFileTypes, recursive, entries, 0);
            return entries;
        }));
    }

    private static void listInto(
        FileSystem fs, String dir, String prefix, boolean withFileTypes, boolean recursive, List<Object> out, int depth
    ) throws FileSystemException, ScriptException {
        if (depth > MAX_DEPTH) throw fsError(ErrorCode.ELOOP, "scandir", dir, null);
        for (var name : fs.list(dir)) {
            var child = fs.combine(dir, name);
            var directory = fs.isDir(child);
            out.add(withFileTypes ? Dirent.of(name, abs(dir), directory) : prefix + name);
            if (recursive && directory) listInto(fs, child, prefix + name + "/", withFileTypes, true, out, depth + 1);
        }
    }

    private @Nullable String doMkdir(String path, boolean recursive) throws ScriptException {
        return fsOp("mkdir", path, null, fs -> {
            if (fs.exists(path)) {
                if (recursive && fs.isDir(path)) return null;
                throw fsError(ErrorCode.EEXIST, "mkdir", path, null);
            }
            var first = FileSystem.sanitizePath(path, true);
            if (recursive) {
                // Find the topmost missing ancestor: that is the first directory created.
                var parent = FileSystem.getDirectory(first);
                for (var i = 0; !parent.isEmpty() && !fs.exists(parent); i++) {
                    if (i > MAX_DEPTH) throw fsError(ErrorCode.ELOOP, "mkdir", path, null);
                    first = parent;
                    parent = FileSystem.getDirectory(parent);
                }
                if (!parent.isEmpty() && !fs.isDir(parent)) throw fsError(ErrorCode.ENOTDIR, "mkdir", path, null);
            } else {
                checkParent(fs, "mkdir", path, null);
            }
            fs.makeDir(path);
            return recursive ? abs(first) : null;
        });
    }

    private void doRm(String path, boolean recursive, boolean force) throws ScriptException {
        fsOp("rm", path, null, fs -> {
            // Mounts silently ignore deleting a missing path, so "not found" has to be detected here.
            if (!fs.exists(path)) {
                if (force) return null;
                throw fsError(ErrorCode.ENOENT, "rm", path, null);
            }
            if (!recursive && fs.isDir(path)) throw fsError(ErrorCode.EISDIR, "rm", path, null);
            fs.delete(path);
            return null;
        });
    }

    private void doRmdir(String path, boolean recursive) throws ScriptException {
        fsOp("rmdir", path, null, fs -> {
            if (!fs.exists(path)) throw fsError(ErrorCode.ENOENT, "rmdir", path, null);
            if (!fs.isDir(path)) throw fsError(ErrorCode.ENOTDIR, "rmdir", path, null);
            if (!recursive && !fs.list(path).isEmpty()) throw fsError(ErrorCode.ENOTEMPTY, "rmdir", path, null);
            fs.delete(path);
            return null;
        });
    }

    private void doUnlink(String path) throws ScriptException {
        fsOp("unlink", path, null, fs -> {
            if (!fs.exists(path)) throw fsError(ErrorCode.ENOENT, "unlink", path, null);
            if (fs.isDir(path)) throw fsError(ErrorCode.EISDIR, "unlink", path, null);
            fs.delete(path);
            return null;
        });
    }

    private void doRename(String src, String dest) throws ScriptException {
        fsOp("rename", src, dest, fs -> {
            if (!fs.exists(src)) throw fsError(ErrorCode.ENOENT, "rename", src, dest);
            if (samePath(src, dest)) return null;
            if (fs.isDir(src) && isInside(src, dest)) throw fsError(ErrorCode.EINVAL, "rename", src, dest);
            if (fs.isReadOnly(src) || fs.isReadOnly(dest)) throw fsError(ErrorCode.EROFS, "rename", src, dest);
            if (fs.exists(dest)) {
                // Node replaces an existing file, or an empty directory when moving a directory.
                if (fs.isDir(dest)) {
                    if (!fs.isDir(src)) throw fsError(ErrorCode.EISDIR, "rename", src, dest);
                    if (!fs.list(dest).isEmpty()) throw fsError(ErrorCode.ENOTEMPTY, "rename", src, dest);
                } else if (fs.isDir(src)) {
                    throw fsError(ErrorCode.ENOTDIR, "rename", src, dest);
                }
                fs.delete(dest);
            } else {
                checkParent(fs, "rename", src, dest);
            }
            fs.move(src, dest);
            return null;
        });
    }

    private void doCopyFile(String src, String dest, boolean exclusive) throws ScriptException {
        fsOp("copyfile", src, dest, fs -> {
            if (!fs.exists(src)) throw fsError(ErrorCode.ENOENT, "copyfile", src, dest);
            if (fs.isDir(src)) throw fsError(ErrorCode.EISDIR, "copyfile", src, dest);
            if (samePath(src, dest)) {
                if (exclusive) throw fsError(ErrorCode.EEXIST, "copyfile", src, dest);
                return null;
            }
            if (fs.exists(dest)) {
                if (exclusive) throw fsError(ErrorCode.EEXIST, "copyfile", src, dest);
                if (fs.isDir(dest)) throw fsError(ErrorCode.EISDIR, "copyfile", src, dest);
                if (fs.isReadOnly(dest)) throw fsError(ErrorCode.EROFS, "copyfile", src, dest);
                fs.delete(dest);
            } else {
                checkParent(fs, "copyfile", src, dest);
            }
            fs.copy(src, dest);
            return null;
        });
    }

    private void doCp(String src, String dest, CpOptions options) throws ScriptException {
        fsOp("cp", src, dest, fs -> {
            if (!fs.exists(src)) throw fsError(ErrorCode.ENOENT, "cp", src, dest);
            var directory = fs.isDir(src);
            if (directory && !options.recursive()) throw fsError(ErrorCode.EISDIR, "cp", src, dest);
            if (samePath(src, dest) || (directory && isInside(src, dest))) {
                throw fsError(ErrorCode.EINVAL, "cp", src, dest);
            }
            // Unlike copyFile, cp creates missing parents of the destination.
            var parent = FileSystem.getDirectory(dest);
            if (!fs.exists(parent)) {
                fs.makeDir(parent);
            } else if (!fs.isDir(parent)) {
                throw fsError(ErrorCode.ENOTDIR, "cp", src, dest);
            }
            copyEntry(fs, src, dest, options, 0);
            return null;
        });
    }

    private static void copyEntry(FileSystem fs, String src, String dest, CpOptions options, int depth)
        throws FileSystemException, ScriptException {
        if (depth > MAX_DEPTH) throw fsError(ErrorCode.ELOOP, "cp", src, dest);
        if (fs.isDir(src)) {
            if (!fs.exists(dest)) {
                fs.makeDir(dest);
            } else if (!fs.isDir(dest)) {
                throw fsError(ErrorCode.ENOTDIR, "cp", src, dest);
            }
            for (var child : fs.list(src)) {
                copyEntry(fs, fs.combine(src, child), fs.combine(dest, child), options, depth + 1);
            }
            return;
        }

        if (fs.exists(dest)) {
            if (fs.isDir(dest)) throw fsError(ErrorCode.EISDIR, "cp", src, dest);
            if (!options.force()) {
                if (options.errorOnExist()) throw fsError(ErrorCode.EEXIST, "cp", src, dest);
                return;
            }
            fs.delete(dest);
        }
        fs.copy(src, dest);
    }

    private void doAccess(String path, int mode) throws ScriptException {
        fsOp("access", path, null, fs -> {
            if (!fs.exists(path)) throw fsError(ErrorCode.ENOENT, "access", path, null);
            if ((mode & W_OK) != 0 && fs.isReadOnly(path)) throw fsError(ErrorCode.EROFS, "access", path, null);
            return null;
        });
    }

    private @Nullable Stats doStat(String path, boolean throwIfNoEntry) throws ScriptException {
        return fsOp("stat", path, null, fs -> {
            if (!fs.exists(path)) {
                if (!throwIfNoEntry) return null;
                throw fsError(ErrorCode.ENOENT, "stat", path, null);
            }
            var attrs = fs.getAttributes(path);
            var modified = millis(attrs.lastModifiedTime());
            return Stats.of(
                attrs.isDirectory(), attrs.isDirectory() ? 0L : attrs.size(),
                attrs.lastAccessTime() != null ? millis(attrs.lastAccessTime()) : modified,
                modified, millis(attrs.creationTime()), fs.isReadOnly(path)
            );
        });
    }

    private static long millis(@Nullable FileTime time) {
        return time == null ? 0 : time.toMillis();
    }

    private String doRealpath(String path) throws ScriptException {
        return Objects.requireNonNull(fsOp("realpath", path, null, fs -> {
            if (!fs.exists(path)) throw fsError(ErrorCode.ENOENT, "realpath", path, null);
            return abs(path);
        }));
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
            err = JSErrors.newError(cx, scope, e);
        }
        JSScheduler.callLater(callback, err, result);
    }
}
