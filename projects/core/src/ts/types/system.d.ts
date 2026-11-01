// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `system` — the computer (ROM module /rom/lib/system): everything of the native `internal/system` (id, label, clock,
// time, sleep, shutdown, timers, …) plus its running programs (#60).

/** A running program, as system.processes() reports it (a snapshot). */
interface ProcessInfo {
    /** Its id (process.pid); 0 is the root process (the bios and OS). */
    readonly pid: number;
    /** The pid of the program that started it (0: the OS). */
    readonly ppid: number;
    /** Its arguments (process.argv): ['bash', '/rom/os/bin/ls.js', …]. */
    readonly argv: readonly string[];
    /** Its working directory. */
    readonly cwd: string;
    /** The native id of the TTY it runs on. */
    readonly tty: number;
    /** When it started, in milliseconds since the epoch. */
    readonly startTime: number;
}

/**
 * The signals for process.kill() / child.kill() / kill, by name, as on Linux (a constant group like Dye):
 * `process.kill(pid, Signal.SIGKILL)`. A program a signal ends exits with 128 + its number.
 */
interface SignalMap {
    /** Interrupt (as Ctrl+C): exit code 130, "Interrupted". */
    readonly SIGINT: 2;
    /** Kill: exit code 137, "Killed"; process.on('exit') listeners do not run. */
    readonly SIGKILL: 9;
    /** Terminate (the default): exit code 143, "Terminated". */
    readonly SIGTERM: 15;
}

/** A signal number (one of the Signal values), like a numeric enum. */
type Signal = SignalMap[keyof SignalMap];
/** A signal's name, as Node uses it ('SIGTERM'). */
type SignalName = keyof SignalMap;

/** The events of the `system` module: a program started, or ended with an exit code. */
interface SystemEventMap {
    processStart: [process: ProcessInfo];
    processEnd: [process: ProcessInfo, code: number];
}

interface SystemModule extends SystemAPI {
    /** The signals: Signal.SIGTERM (15), Signal.SIGINT (2), Signal.SIGKILL (9). */
    readonly Signal: SignalMap;
    /** A time of day (hours 0–24, default: system.time()) as "6:30 PM", or with `hour12` false as "18:30". */
    formatTime(time?: number, hour12?: boolean): string;
    /** The running programs, by pid (the root process, pid 0, first). */
    processes(): ProcessInfo[];
    /** The running program with `pid`, or undefined. */
    process(pid: number): ProcessInfo | undefined;
    /**
     * Listen to programs starting ('processStart') and ending ('processEnd', with the exit code). Like `events.on`
     * (they are the events `process_start` / `process_end`): the listener belongs to the calling thread.
     */
    on<K extends keyof SystemEventMap>(event: K, listener: (...args: SystemEventMap[K]) => void): SystemModule;
    once<K extends keyof SystemEventMap>(event: K, listener: (...args: SystemEventMap[K]) => void): SystemModule;
    off<K extends keyof SystemEventMap>(event: K, listener: (...args: SystemEventMap[K]) => void): SystemModule;
}

interface SystemModulePromises extends SystemAPIPromises {
    processes(): Promise<ProcessInfo[]>;
    process(pid: number): Promise<ProcessInfo | undefined>;
}

interface CustomEventMap {
    /** A program started (emitted by the ROM's job control; system.on('processStart') listens to it). */
    process_start: [process: ProcessInfo];
    /** A program ended with an exit code. */
    process_end: [process: ProcessInfo, code: number];
}

declare function require(id: "system"): SystemModule;
declare function require(id: "system/promises"): SystemModulePromises;
declare module "system" { const system: SystemModule; export = system; }
declare module "system/promises" { const systemPromises: SystemModulePromises; export = systemPromises; }

// The native module behind `system` (SystemAPI); ROM-internal, programs use `system`.
declare module "internal/system" { const system: SystemAPI; export = system; }
declare module "internal/system/promises" { const systemPromises: SystemAPIPromises; export = systemPromises; }
