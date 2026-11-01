// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// kill — end programs by pid (see ps):
//
//   kill <pid>…                 SIGTERM: "Terminated", exit code 143
//   kill -s <signal> <pid>…     or -<signal>: SIGTERM, SIGINT, SIGKILL (also without SIG, or 15, 2, 9)
//   kill -l                     list the signals

import { Signal } from 'system';

/** `text` (TERM, SIGTERM, 15) as a Signal, or undefined. */
function signalOf(text: string): Signal | undefined {
    let upper = text.toUpperCase();
    for (let [name, number] of Object.entries(Signal)) {
        if (upper === name || 'SIG' + upper === name || text === String(number)) return number;
    }
    return undefined;
}

export function main(args: string[]): void {
    if (args[0] === '-l') {
        console.log(Object.entries(Signal).map(([name, number]) => `${number}) ${name}`).join('  '));
        return;
    }
    let signal: Signal = Signal.SIGTERM;
    let pids = args;
    if (args[0] === '-s' || (args[0]?.startsWith('-') && args[0].length > 1)) {
        let given = args[0] === '-s' ? args[1] : args[0].slice(1);
        let named = given === undefined ? undefined : signalOf(given);
        if (named === undefined) return fail(`kill: ${given ?? ''}: invalid signal specification`);
        signal = named;
        pids = args.slice(args[0] === '-s' ? 2 : 1);
    }
    if (pids.length === 0) return fail('Usage: kill [-s signal | -signal] <pid>… | kill -l');
    for (let text of pids) {
        let pid = Number(text);
        if (!Number.isInteger(pid) || pid < 0) {
            fail(`kill: ${text}: arguments must be process ids`);
            continue;
        }
        try {
            process.kill(pid, signal);
        } catch (error: any) {
            fail(error?.code === 'ESRCH' ? `kill: (${pid}) - No such process`
                : error?.code === 'EPERM' ? `kill: (${pid}) - Operation not permitted`
                : `kill: ${error?.message ?? error}`);
        }
    }
}

function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
}
