// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/process.ts — Node's `process`, for what a computer has: the streams of the program's TTY
// (stdin/stdout/stderr), its arguments and working directory, environment variables, exit codes and timing.
//
// One object for the whole computer, installed as the global `process` by the bios (and returned by
// `require('process')`); it always means the *calling* program (see the jobs in /rom/lib/internal/tty): each program
// has its own TTY, argv, working directory and exit code, so chdir() in a program does not move its shell. Things a
// computer does not have (signals, memory usage, …) are deliberately absent rather than faked.

import * as jobs from '/rom/lib/internal/tty';
import * as env from '/rom/lib/env';

import fs from 'fs';
import events from 'events';
import system from 'system';
import { validateFunction, validateInteger, validateOneOf, validateString } from '/rom/lib/internal/validators';
import { ERR_UNKNOWN_SIGNAL } from '/rom/lib/internal/errors';
import { Signal } from '/rom/lib/system';

/** Normalise `p` against the current directory. */
function resolvePath(p: string): string {
    let cwd = jobs.current().cwd;
    let raw = (p.startsWith('/') ? '' : cwd.replace(/\/$/, '') + '/') + p;
    let out: string[] = [];
    for (let seg of raw.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') out.pop(); else out.push(seg);
    }
    return '/' + out.join('/');
}

function chdir(directory: string): void {
    validateString(directory, 'directory');
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
        let err = new Error(`${code}: ${exists ? 'not a directory' : 'no such file or directory'}, `
            + `chdir '${jobs.current().cwd}' -> '${directory}'`);
        (err as any).code = code;
        (err as any).syscall = 'chdir';
        (err as any).path = directory;
        throw err;
    }
    jobs.current().cwd = target;
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

/** `signal` (a Signal or Node's name) as a signal's name; undefined for 0 (only test that the process exists). */
function toSignalName(signal: unknown): SignalName | undefined {
    if (signal === 0) return undefined;
    let name = jobs.signalName(signal);
    if (name !== undefined) return name;
    if (typeof signal !== 'number') validateString(signal, 'signal');
    throw new ERR_UNKNOWN_SIGNAL(String(signal));
}

/** A Node-style system error (`kill ESRCH`), with `code`, `errno` and `syscall`. */
function systemError(code: 'ESRCH' | 'EPERM', syscall: string): Error {
    let err = new Error(`${syscall} ${code}`);
    Object.assign(err, { code, errno: code === 'ESRCH' ? -3 : -1, syscall });
    return err;
}

/** The events `process` emits: only 'exit' (signals end a program, they are not delivered as events). */
const PROCESS_EVENTS = ['exit'] as const;

type ExitListener = ((code: number) => void) & { listener?: (code: number) => void };

function addListener(event: 'exit', listener: (code: number) => void): Process {
    validateOneOf(event, 'event', PROCESS_EVENTS);
    validateFunction(listener, 'listener');
    jobs.current().exitListeners.push(listener);
    return proc;
}

function removeListener(event: 'exit', listener: (code: number) => void): Process {
    validateOneOf(event, 'event', PROCESS_EVENTS);
    let listeners: ExitListener[] = jobs.current().exitListeners;
    for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i] === listener || listeners[i].listener === listener) {
            listeners.splice(i, 1);
            break;
        }
    }
    return proc;
}

const proc: Process = {
    get stdin() { return jobs.current().tty.stdin; },
    get stdout() { return jobs.current().tty.stdout; },
    get stderr() { return jobs.current().tty.stderr; },

    get argv() { return jobs.current().argv; },
    set argv(value: string[]) { jobs.current().argv = value; },
    get argv0() { return jobs.current().argv[0] ?? 'bash'; },
    execArgv: [],
    env: envProxy,
    platform: 'computercraft',
    get pid() { return jobs.current().id; },
    get ppid() { return jobs.current().ppid; },
    get exitCode() { return jobs.current().exitCode; },
    set exitCode(value: number | undefined) { jobs.current().exitCode = value; },

    cwd(): string { return jobs.current().cwd; },
    chdir,

    exit(code?: number): never {
        if (code !== undefined) proc.exitCode = code;
        let exitCode = typeof proc.exitCode === 'number' ? proc.exitCode : 0;
        // Outside of a program (the bios, the OS layer) the whole computer is the process.
        if (jobs.current() === jobs.root) system.shutdown();
        throw jobs.requestExit(exitCode);
    },

    on: addListener,
    addListener,
    once(event: 'exit', listener: (code: number) => void): Process {
        validateFunction(listener, 'listener');
        let wrapper: ExitListener = (code) => {
            removeListener(event, wrapper);
            listener(code);
        };
        wrapper.listener = listener;
        return addListener(event, wrapper);
    },
    off: removeListener,
    removeListener,
    listenerCount(event: 'exit'): number {
        validateOneOf(event, 'event', PROCESS_EVENTS);
        return jobs.current().exitListeners.length;
    },

    kill(pid: number, signal: Signal | SignalName | 0 = Signal.SIGTERM): true {
        validateInteger(pid, 'pid');
        let name = toSignalName(signal);
        let job = jobs.processOf(pid);
        if (job === undefined) throw systemError('ESRCH', 'kill');
        // Signal 0 only checks that the process exists (and may be signalled), as in Node.
        if (pid === 0) throw systemError('EPERM', 'kill');
        if (name !== undefined) jobs.kill(job, name);
        return true;
    },

    nextTick: function (callback: (...args: any[]) => void, ...args: any[]): void {
        events.queueMicrotask(() => callback(...args));
    } as Process['nextTick'],

    hrtime,

    uptime(): number { return system.clock(); },

    emitWarning(warning: string | Error, type?: string): void {
        let message = typeof warning === 'string' ? warning : warning.message;
        let name = typeof warning === 'string' ? (type ?? 'Warning') : (warning.name || 'Warning');
        jobs.current().tty.stderr.write(`${name}: ${message}\n`);
    },
};

// The module is the process object itself (`require('process') === process`), as in Node: not a namespace of named
// exports, so it replaces module.exports.
module.exports = proc;
