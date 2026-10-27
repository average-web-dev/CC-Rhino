// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/process.ts — Node's `process`, for what a computer has: the terminal streams (stdin/stdout/stderr, see
// internal/tty), the program's arguments and working directory, environment variables, exit codes and timing.
//
// One object for the whole computer, installed as the global `process` by the bios (and returned by
// `require('process')`). The shell runs one foreground program at a time and sets argv / restores cwd around it, so
// for a program they behave like those of its own process. Things a computer does not have (pid, signals, memory
// usage, …) are deliberately absent rather than faked.

import tty = require('/rom/lib/internal/tty');
import env = require('/rom/lib/env');

const fs = require('fs');
const events = require('events');
const system = require('system');

let cwd = '/';

/** Normalise `p` against the current directory. */
function resolvePath(p: string): string {
    let raw = (p.startsWith('/') ? '' : cwd.replace(/\/$/, '') + '/') + p;
    let out: string[] = [];
    for (let seg of raw.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') out.pop(); else out.push(seg);
    }
    return '/' + out.join('/');
}

function chdir(directory: string): void {
    if (typeof directory !== 'string') {
        let err = new TypeError('The "directory" argument must be of type string');
        (err as any).code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    let target = resolvePath(directory);
    let isDirectory = false;
    let exists = false;
    try {
        isDirectory = fs.statSync(target).isDirectory();
        exists = true;
    } catch {
        exists = false;
    }
    if (!isDirectory) {
        let code = exists ? 'ENOTDIR' : 'ENOENT';
        let err = new Error(
            `${code}: ${exists ? 'not a directory' : 'no such file or directory'}, chdir '${cwd}' -> '${directory}'`);
        (err as any).code = code;
        (err as any).syscall = 'chdir';
        (err as any).path = directory;
        throw err;
    }
    cwd = target;
}

/** process.env: a live view of the `env` module (PATH included, which mirrors require.paths). */
const envProxy = new Proxy({} as Record<string, string | undefined>, {
    get(_target, name) {
        if (typeof name !== 'string') return undefined;
        let value = env.get(name);
        return value === null ? undefined : value;
    },
    set(_target, name, value) {
        if (typeof name === 'string') env.set(name, String(value));
        return true;
    },
    deleteProperty(_target, name) {
        if (typeof name === 'string') env.unset(name);
        return true;
    },
    has(_target, name) {
        return typeof name === 'string' && env.has(name);
    },
    ownKeys() {
        return Object.keys(env.all());
    },
    getOwnPropertyDescriptor(_target, name) {
        if (typeof name !== 'string' || !env.has(name)) return undefined;
        return { value: env.get(name), writable: true, enumerable: true, configurable: true };
    },
});

function hrtime(previous?: [number, number]): [number, number] {
    let now = Date.now();
    let seconds = Math.floor(now / 1000);
    let nanos = (now % 1000) * 1e6;
    if (previous !== undefined) {
        seconds -= previous[0];
        nanos -= previous[1];
        if (nanos < 0) { seconds--; nanos += 1e9; }
    }
    return [seconds, nanos];
}
hrtime.bigint = function (): bigint {
    return BigInt(Date.now()) * BigInt(1000000);
};

const proc: Process = {
    stdin: tty.stdin,
    stdout: tty.stdout,
    stderr: tty.stderr,

    argv: ['bash'],
    argv0: 'bash',
    execArgv: [],
    env: envProxy,
    platform: 'computercraft',
    exitCode: undefined,

    cwd(): string { return cwd; },
    chdir,

    exit(code?: number): never {
        if (code !== undefined) proc.exitCode = code;
        let exitCode = typeof proc.exitCode === 'number' ? proc.exitCode : 0;
        // Outside of a program (the shell or the bios) the whole computer is the process.
        if (tty.jobId() === 0) system.shutdown();
        throw tty.requestExit(exitCode);
    },

    // `arguments` rather than a rest parameter: Rhino mixes up `callback, ...args` when nextTick is applied.
    nextTick: function (callback: (...args: any[]) => void): void {
        let args: any[] = Array.prototype.slice.call(arguments, 1);
        events.queueMicrotask(() => callback.apply(undefined, args));
    } as Process['nextTick'],

    hrtime,

    uptime(): number { return system.clock(); },

    emitWarning(warning: string | Error, type?: string): void {
        let message = typeof warning === 'string' ? warning : warning.message;
        let name = typeof warning === 'string' ? (type ?? 'Warning') : (warning.name || 'Warning');
        tty.stderr.write(`${name}: ${message}\n`);
    },
};

export = proc;
