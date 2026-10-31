// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/child_process.ts — Node's child_process for CC programs.
//
//   const child = spawn('ls', ['-l']);                         // output on a fresh virtual TTY
//   child.stdout.on('data', (d) => …); child.on('exit', (code) => …);
//   const { status, stdout } = spawnSync('ls', [], { stdio: 'pipe' });
//   exec('ls /rom', (err, stdout, stderr) => …);  execSync('echo hi');     // a command line, through bash -c
//   spawn('top', [], { stdio: TTY.from(monitor.getTty()) });              // CC: run a program on another TTY
//
// A child is a program run as a job (see /rom/lib/internal/tty): a thread of its own whose `process` is the child's —
// its TTY, argv, working directory (the parent's, or options.cwd) and exit code. `stdio` picks the TTY:
// - 'pipe': a fresh virtual TTY; child.stdin types into it, child.stdout / child.stderr read what the child writes;
// - 'inherit': the parent's TTY (the default for spawnSync, as a shell runs its programs);
// - a TTY (or a native TTY handle): a CC extension, e.g. a console of the screen or a monitor.
// A program that fails is reported on its own stderr and exits with code 1. A child keeps its parent running until it
// exits (as an un-unref'd Node child does).

import { EventEmitter } from '/rom/lib/internal/emitter';
import * as jobs from '/rom/lib/internal/tty';
import { TTY, ReadStream } from '/rom/lib/tty';
import parallel from 'parallel';

/** Where a child's stdin/stdout/stderr go. */
export type StdioOption = 'pipe' | 'inherit' | TTY | TtyHandle;

export interface SpawnOptions {
    /** The child's working directory (default: the parent's). */
    cwd?: string;
    /** The child's TTY (default 'pipe' for spawn/exec, 'inherit' for spawnSync, 'pipe' for execSync). */
    stdio?: StdioOption;
    /** The size of a fresh virtual TTY ('pipe'), default 51 × 19. */
    columns?: number;
    rows?: number;
}

function notFound(program: string): Error {
    let err = new Error(`spawn ${program} ENOENT`);
    (err as any).code = 'ENOENT';
    (err as any).syscall = 'spawn ' + program;
    (err as any).path = program;
    return err;
}

/** Resolve a program like the shell does: a path against the working directory, a bare name on require.paths. */
function resolveProgram(program: string, cwd: string): string {
    let isPath = program.startsWith('/') || program.startsWith('./') || program.startsWith('../');
    let target = program;
    if (isPath) {
        let raw = (program.startsWith('/') ? '' : cwd.replace(/\/$/, '') + '/') + program;
        let out: string[] = [];
        for (let seg of raw.split('/')) {
            if (seg === '' || seg === '.') continue;
            if (seg === '..') out.pop(); else out.push(seg);
        }
        target = '/' + out.join('/');
    }
    try {
        return require.resolve(target);
    } catch {
        throw notFound(program);
    }
}

function ttyFor(stdio: StdioOption, options: SpawnOptions): { tty: TTY; piped: boolean } {
    if (stdio === 'pipe') return { tty: jobs.createVirtual(options.columns, options.rows), piped: true };
    if (stdio === 'inherit') return { tty: jobs.current().tty, piped: false };
    if (stdio instanceof TTY) return { tty: stdio, piped: false };
    if (stdio !== null && typeof stdio === 'object' && typeof (stdio as TtyHandle).getStdin === 'function') {
        return { tty: jobs.ttyOf(stdio as TtyHandle), piped: false };
    }
    throw new TypeError(`The "options.stdio" property must be 'pipe', 'inherit' or a TTY, got ${String(stdio)}`);
}

function createJob(program: string, args: string[], options: SpawnOptions, defaultStdio: StdioOption) {
    if (!Array.isArray(args)) throw new TypeError('The "args" argument must be an array');
    let cwd = options.cwd ?? jobs.current().cwd;
    let resolved = resolveProgram(program, cwd);
    let { tty, piped } = ttyFor(options.stdio ?? defaultStdio, options);
    let job = jobs.createJob(tty, ['bash', '/' + resolved.replace(/^\/+/, '')].concat(args), cwd);
    return { job, resolved, piped };
}

/** The writable side of a piped child's stdin: what is written is typed into its TTY. */
class ChildStdin {
    readonly writable = true;
    #tty: TTY;

    constructor(tty: TTY) {
        this.#tty = tty;
    }

    write(chunk: string | Uint8Array, encoding?: string | ((err: Error | null) => void), callback?: (err: Error | null) => void): boolean {
        if (typeof encoding === 'function') callback = encoding;
        let text = typeof chunk === 'string' ? chunk : String.fromCharCode.apply(null, Array.prototype.slice.call(chunk));
        this.#tty.input(text);
        if (typeof callback === 'function') queueMicrotask(() => callback!(null));
        return true;
    }

    /** End of input: like Ctrl+D on an empty line. */
    end(chunk?: string | Uint8Array): void {
        if (chunk !== undefined) this.write(chunk);
        this.#tty.input('\x04');
    }
}

/**
 * A running (or finished) child program, as returned by spawn() and exec(). 'exit' says how it ended; 'close' follows
 * once its output (stdio 'pipe') has been delivered.
 */
export class ChildProcess extends EventEmitter {
    readonly pid: number;
    /** The child's TTY. */
    readonly tty: TTY;
    /** For stdio 'pipe': type into the child (null otherwise). */
    readonly stdin: ChildStdin | null;
    /** For stdio 'pipe': what the child writes (null otherwise). */
    readonly stdout: ReadStream | null;
    readonly stderr: ReadStream | null;
    exitCode: number | null = null;
    signalCode: string | null = null;
    killed = false;
    #thread: ThreadHandle | undefined;
    #exited = false;

    constructor(job: jobs.Job, piped: boolean) {
        super();
        this.pid = job.id;
        this.tty = job.tty;
        let handle = job.tty.handle;
        this.stdin = piped ? new ChildStdin(job.tty) : null;
        this.stdout = piped ? new ReadStream(handle, { pipe: handle.getStdout() }) : null;
        this.stderr = piped ? new ReadStream(handle, { pipe: handle.getStderr() }) : null;
    }

    /** Stop the child (its blocked calls end, nothing it started runs on). Returns false if it already exited. */
    kill(_signal?: string): boolean {
        if (this.#exited) return false;
        this.killed = true;
        if (this.#thread !== undefined) this.#thread.stop();
        return true;
    }

    /** @internal */
    _started(thread: ThreadHandle): void {
        this.#thread = thread;
        if (this.killed) thread.stop();
    }

    /** @internal */
    _exited(result: jobs.JobResult): void {
        this.#exited = true;
        if (this.killed) {
            this.signalCode = 'SIGTERM';
        } else {
            this.exitCode = result.code;
        }
        this.emit('exit', this.exitCode, this.signalCode);
        if (this.stdout === null || this.stderr === null) {
            this.emit('close', this.exitCode, this.signalCode);
            return;
        }
        // As in Node, 'close' comes once the child's output has been delivered: after both streams ended.
        let open = 2;
        let ended = () => {
            if (--open === 0) this.emit('close', this.exitCode, this.signalCode);
        };
        this.stdout.once('end', ended);
        this.stderr.once('end', ended);
        this.stdout.resume();
        this.stderr.resume();
        this.tty.handle.getStdout().end();
        this.tty.handle.getStderr().end();
    }
}

/**
 * Start a program and return at once. The child runs in the background (Ctrl+C reaches it only on its own TTY);
 * its 'exit' event says how it ended.
 */
export function spawn(program: string, args: string[] = [], options: SpawnOptions = {}): ChildProcess {
    let { job, resolved, piped } = createJob(program, args, options, 'pipe');
    let child = new ChildProcess(job, piped);
    parallel.spawn(() => {
        let result = jobs.run(job, resolved, args, { background: true, onStart: (thread) => child._started(thread) });
        child._exited(result);
    });
    return child;
}

/** What spawnSync() returns. */
export interface SpawnSyncResult {
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

/** Read everything a finished child wrote to `pipe`. */
function drain(pipe: PipeHandle): string {
    let out = '';
    while (true) {
        let data = pipe.tryRead();
        if (data === undefined || data === '') return out;
        out += data;
    }
}

/** Run a program and wait for it (as a shell does: by default on the caller's TTY, in its foreground). */
export function spawnSync(program: string, args: string[] = [], options: SpawnOptions = {}): SpawnSyncResult {
    let created;
    try {
        created = createJob(program, args, options, 'inherit');
    } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e;
        return { pid: 0, status: null, signal: null, stdout: '', stderr: '', error: e };
    }
    let { job, resolved, piped } = created;
    let result = jobs.run(job, resolved, args);
    let handle = job.tty.handle;
    return {
        pid: job.id, status: result.code, signal: null,
        stdout: piped ? drain(handle.getStdout()) : '',
        stderr: piped ? drain(handle.getStderr()) : '',
    };
}

/** An error for a command that failed (Node's exec / execSync). */
function commandFailed(command: string, status: number, stdout: string, stderr: string): Error {
    let err = new Error(`Command failed: ${command}\n${stderr}`);
    Object.assign(err, { code: status, status, stdout, stderr, cmd: command });
    return err;
}

/** Run a command line through `bash -c` and collect its output: `callback(error, stdout, stderr)`. */
export function exec(command: string, options?: SpawnOptions | ((error: Error | null, stdout: string, stderr: string) => void),
    callback?: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess {
    if (typeof options === 'function') { callback = options; options = undefined; }
    let child = spawn('/rom/bin/bash', ['-c', command], { ...(options ?? {}), stdio: 'pipe' });
    let stdout = '', stderr = '';
    child.stdout!.on('data', (d: string) => { stdout += d; });
    child.stderr!.on('data', (d: string) => { stderr += d; });
    child.on('close', (code: number | null) => {
        if (callback === undefined) return;
        let status = code ?? 1;
        callback(status === 0 ? null : commandFailed(command, status, stdout, stderr), stdout, stderr);
    });
    return child;
}

/** Run a command line through `bash -c`, wait for it and return what it wrote; throws if it fails. */
export function execSync(command: string, options: SpawnOptions = {}): string {
    let result = spawnSync('/rom/bin/bash', ['-c', command], { stdio: 'pipe', ...options });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw commandFailed(command, result.status ?? 1, result.stdout, result.stderr);
    return result.stdout;
}
