// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `child_process` — run programs as children (ROM module /rom/lib/child_process), and `os.run`.

/** Where a child's stdin/stdout/stderr go: a fresh virtual TTY, the caller's TTY, or a given TTY (CC extension). */
type StdioOption = "pipe" | "inherit" | TTY | TtyHandle;

interface SpawnOptions {
    /** The child's working directory (default: the parent's). */
    cwd?: string;
    /** The child's TTY (default 'pipe' for spawn/exec/execSync, 'inherit' for spawnSync). */
    stdio?: StdioOption;
    /** The size of a fresh virtual TTY ('pipe'), default 51 × 19. */
    columns?: number;
    rows?: number;
}

/** The writable side of a piped child's stdin: what is written is typed into its TTY. */
interface ChildStdin {
    readonly writable: true;
    write(chunk: string | Uint8Array, encoding?: string | ((err: Error | null) => void), callback?: (err: Error | null) => void): boolean;
    /** End of input (like Ctrl+D on an empty line). */
    end(chunk?: string | Uint8Array): void;
}

/** A running (or finished) child program. Events: 'exit' and 'close' with (code, signal). */
interface ChildProcess {
    readonly pid: number;
    /** The child's TTY. */
    readonly tty: TTY;
    /** For stdio 'pipe': type into the child (null otherwise). */
    readonly stdin: ChildStdin | null;
    /** For stdio 'pipe': what the child writes (null otherwise). */
    readonly stdout: TtyStdin | null;
    readonly stderr: TtyStdin | null;
    exitCode: number | null;
    signalCode: string | null;
    killed: boolean;
    /** Stop the child. Returns false if it already exited. */
    kill(signal?: string): boolean;
    on(event: "exit" | "close", listener: (code: number | null, signal: string | null) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
}

interface SpawnSyncResult {
    pid: number;
    /** The exit code, or null if the program could not be started. */
    status: number | null;
    signal: string | null;
    /** What the child wrote (stdio 'pipe'; '' otherwise). */
    stdout: string;
    stderr: string;
    /** Why the program could not be started (ENOENT). */
    error?: Error;
}

interface ChildProcessModule {
    /** Start a program (a path, or a name on the PATH) and return at once. */
    spawn(program: string, args?: string[], options?: SpawnOptions): ChildProcess;
    /** Run a program and wait for it (by default on the caller's TTY, in its foreground). */
    spawnSync(program: string, args?: string[], options?: SpawnOptions): SpawnSyncResult;
    /** Run a command line through `bash -c` and collect its output. */
    exec(command: string, callback?: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
    exec(command: string, options: SpawnOptions, callback?: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
    /** Run a command line through `bash -c`, wait and return what it wrote; throws if it fails. */
    execSync(command: string, options?: SpawnOptions): string;
    ChildProcess: { readonly prototype: ChildProcess };
}

interface OsRunOptions {
    /** The TTY to run on (default: the caller's). */
    tty?: TTY | TtyHandle;
    /** The working directory (default: the caller's). */
    cwd?: string;
}

interface OsModule {
    /** Run a program and wait for it, as the shell does; returns its exit code (throws ENOENT if there is none). */
    run(program: string, args?: string[], options?: OsRunOptions): number;
}

declare function require(id: "child_process"): ChildProcessModule;
declare function require(id: "node:child_process"): ChildProcessModule;
declare function require(id: "os"): OsModule;
declare module "child_process" { const childProcess: ChildProcessModule; export = childProcess; }
declare module "node:child_process" { const childProcess: ChildProcessModule; export = childProcess; }
declare module "os" { const os: OsModule; export = os; }
