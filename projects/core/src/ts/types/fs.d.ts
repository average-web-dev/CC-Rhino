// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Shapes used by the `fs` module (Node `fs`-compatible). The functions themselves are generated from FSAPI.java
// (common/build/tsTypes/FSAPI.d.ts); this file adds the data types and the non-function properties.

/** Text encodings understood by `fs` (`"utf8"` is the default). `latin1`/`binary`/`ascii` give one char per byte. */
type FsEncoding = "utf8" | "utf-8" | "latin1" | "binary" | "ascii" | "base64" | "hex";

/** A Node-style fs error: `code` is e.g. `"ENOENT"`, `"EEXIST"`, `"ENOTDIR"`, `"EISDIR"`, `"ENOTEMPTY"`, `"EROFS"`. */
interface FsError extends Error {
    code: string;
    errno?: number;
    syscall?: string;
    path?: string;
    dest?: string;
}

interface FsReadFileOptions {
    encoding?: FsEncoding | null;
    /** Accepted for compatibility; reads always use `"r"`. */
    flag?: string;
}

interface FsWriteFileOptions {
    encoding?: FsEncoding | null;
    /** `"w"` (default for writeFile) or `"a"` (default for appendFile), optionally with `"x"` and/or `"+"`. */
    flag?: string;
    /** Ignored: CC has no permissions. */
    mode?: number;
}

interface FsReaddirOptions {
    /** Ignored: names are always strings. */
    encoding?: FsEncoding | null;
    /** Return `FsDirent` objects instead of names. */
    withFileTypes?: boolean;
    /** Include the contents of subdirectories (as paths relative to the listed directory). */
    recursive?: boolean;
}

interface FsMkdirOptions {
    recursive?: boolean;
    /** Ignored: CC has no permissions. */
    mode?: number;
}

interface FsRmOptions {
    recursive?: boolean;
    force?: boolean;
}

interface FsRmdirOptions {
    /** Deprecated in Node: behaves like `rm` with `recursive`. */
    recursive?: boolean;
}

interface FsCpOptions {
    recursive?: boolean;
    /** Overwrite existing files (default `true`). */
    force?: boolean;
    /** With `force: false`, fail with `EEXIST` instead of skipping existing files. */
    errorOnExist?: boolean;
}

interface FsStatOptions {
    /** `false` makes `statSync` return `undefined` for a missing path instead of throwing `ENOENT`. */
    throwIfNoEntry?: boolean;
}

/** Node-style `fs.Stats`. Times are epoch milliseconds (there are no `Date` fields). */
interface FsStats {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    /** CC extension: the path lives on a read-only mount. */
    readOnly: boolean;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}

/** Node-style `fs.Dirent`, returned by `readdir` with `withFileTypes`. */
interface FsDirent {
    name: string;
    /** Absolute path of the directory containing the entry. */
    parentPath: string;
    /** Deprecated alias of `parentPath`. */
    path: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}

interface FsConstants {
    readonly F_OK: number;
    readonly R_OK: number;
    readonly W_OK: number;
    readonly X_OK: number;
    readonly COPYFILE_EXCL: number;
    readonly COPYFILE_FICLONE: number;
    readonly COPYFILE_FICLONE_FORCE: number;
}

// Merges with the generated `interface FSAPI`.
interface FSAPI {
    /** Access modes and copy flags (`fs.constants.F_OK`, `fs.constants.COPYFILE_EXCL`, …). */
    readonly constants: FsConstants;
    readonly F_OK: number;
    readonly R_OK: number;
    readonly W_OK: number;
    readonly X_OK: number;
}
