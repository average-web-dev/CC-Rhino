// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `fs` — modelled on Node `fs` (callback) + `fs.…Sync` (blocking).

/** File attributes, as returned by {@link FsModule.statSync}. Replaces the old `attributes`. */
interface Stats {
    /** Size in bytes (0 for directories). */
    size: number;
    /** Last-modified time, in milliseconds since the epoch. Use `new Date(stat.mtimeMs)`. */
    mtimeMs: number;
    /** Status-change time, in milliseconds since the epoch. */
    ctimeMs: number;
    /** Creation time, in milliseconds since the epoch. */
    birthtimeMs: number;
    /** True if the path is a directory. Plain boolean — CC has no symlinks, no need for a method. */
    isDirectory: boolean;
    /** True if the path is a regular file. */
    isFile: boolean;
    /** CC extension: whether the path is on a read-only mount. */
    isReadOnly: boolean;
}

/** An open file handle, as returned by {@link FsModule.openSync}. */
interface FileHandle {
    /** Read up to `count` bytes/chars (a single byte as a number in binary mode), or `null` at EOF. */
    read(count?: number): string | Buffer | number | null;
    /** Read the next line, or `null` at EOF. */
    readLine(withTrailing?: boolean): string | null;
    /** Read the entire remaining contents. */
    readAll(): string | Buffer;
    write(data: string | Buffer): void;
    /** Move the read/write pointer; returns the new absolute position. */
    seek(whence?: "set" | "cur" | "end", offset?: number): number;
    flush(): void;
    close(): void;
}

/** Open modes, optionally suffixed with `b` for binary. */
type OpenFlags =
    | "r" | "w" | "a" | "r+" | "w+"
    | "rb" | "wb" | "ab" | "r+b" | "w+b";

interface MkdirOptions {
    /** Create parent directories as needed. Defaults to `true` (unlike Node). */
    recursive?: boolean;
}

interface RmOptions {
    recursive?: boolean;
    force?: boolean;
}

interface CpOptions {
    recursive?: boolean;
}

interface FsModule {
    // --- read/write ---
    readFileSync(path: string, encoding?: Encoding): string | Buffer;
    readFile(path: string, encoding: Encoding, cb: Callback<string | Buffer>): void;
    readFile(path: string, cb: Callback<string | Buffer>): void;

    writeFileSync(path: string, data: string | Buffer, encoding?: Encoding): void;
    writeFile(path: string, data: string | Buffer, encoding: Encoding, cb: ErrorCallback): void;
    writeFile(path: string, data: string | Buffer, cb: ErrorCallback): void;

    appendFileSync(path: string, data: string | Buffer, encoding?: Encoding): void;
    appendFile(path: string, data: string | Buffer, encoding: Encoding, cb: ErrorCallback): void;
    appendFile(path: string, data: string | Buffer, cb: ErrorCallback): void;

    // --- directory / entry manipulation ---
    readdirSync(path: string): string[];
    readdir(path: string, cb: Callback<string[]>): void;

    mkdirSync(path: string, options?: MkdirOptions): void;
    mkdir(path: string, options: MkdirOptions, cb: ErrorCallback): void;
    mkdir(path: string, cb: ErrorCallback): void;

    rmSync(path: string, options?: RmOptions): void;
    rm(path: string, options: RmOptions, cb: ErrorCallback): void;
    rm(path: string, cb: ErrorCallback): void;

    renameSync(src: string, dest: string): void;
    rename(src: string, dest: string, cb: ErrorCallback): void;

    cpSync(src: string, dest: string, options?: CpOptions): void;
    cp(src: string, dest: string, options: CpOptions, cb: ErrorCallback): void;
    cp(src: string, dest: string, cb: ErrorCallback): void;

    copyFileSync(src: string, dest: string): void;
    copyFile(src: string, dest: string, cb: ErrorCallback): void;

    // --- querying ---
    existsSync(path: string): boolean;

    statSync(path: string): Stats;
    stat(path: string, cb: Callback<Stats>): void;

    realpathSync(path: string): string;

    // --- handles (deferred — file-handle bridge not yet implemented) ---
    openSync?(path: string, flags: OpenFlags): FileHandle;
    open?(path: string, flags: OpenFlags, cb: Callback<FileHandle>): void;

    // --- CC-specific extensions (no Node equivalent) ---
    /** Name of the mount a path lives on (e.g. `"hdd"`, `"rom"`), or `null` if it doesn't exist. */
    getDrive(path: string): string | null;
    /** Total capacity of the path's mount in bytes, or `null` for read-only mounts. */
    getCapacity(path: string): number | null;
    /** Free space on the path's mount in bytes, or `"unlimited"`. */
    getFreeSpace(path: string): number | "unlimited";
    isReadOnly(path: string): boolean;
}
