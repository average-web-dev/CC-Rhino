// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/index.ts — OS init layer ("kernel")
// Responsibilities: boot log, device detection, PATH setup, shell handoff.
// Everything after this (aliases, autorun, completion) is bash's or future layers' job.

import system from 'system';
import util   from 'util';
import screen from 'screen';
import events from 'events';
import * as jobs from '/rom/lib/internal/tty';
import { spawn } from '/rom/lib/child_process';
import { CSI } from '/rom/lib/tty';

// ── Kernel log ─────────────────────────────────────────────────────────────────
// Inspired by Linux dmesg / systemd service lines. The tag colours are ANSI styles, which process.stdout maps onto the
// terminal's colours (and ignores on monochrome terminals).

function klog(level: 'ok' | 'info' | 'fail', msg: string): void {
    const tag = level === 'ok'   ? util.styleText('greenBright', '[  OK  ]')
              : level === 'fail' ? util.styleText('red', '[ FAIL ]')
                                 : util.styleText('white', '[      ]');
    console.log(tag + ' ' + msg);
}

// ── Device detection ───────────────────────────────────────────────────────────
// Native modules are only registered when the hardware is present, so a failed
// require means "not this device type".

function detectDevice(): 'turtle' | 'pocket' | 'command' | 'standard' {
    try { require('turtle');   return 'turtle';   } catch {}
    try { require('pocket');   return 'pocket';   } catch {}
    try { require('commands'); return 'command';  } catch {}
    return 'standard';
}

// ── Boot sequence ──────────────────────────────────────────────────────────────

klog('info', 'CC: Rhino  kernel  v1.21.0');

const device = detectDevice();
klog('ok', `Computer ${system.getComputerID()} - ${device}`);

const label = system.getComputerLabel();
if (label) klog('info', `Label: ${label}`);

// Setting the module search path also defines PATH: the env module exposes PATH
// as a live alias of require.paths, so `echo $PATH` and `export PATH=...` just work.
require.paths = ['/rom/os/bin', '/rom/bin', '/rom/lib'];
klog('ok', 'Module paths: ' + require.paths.join(', '));

klog('ok', 'Kernel ready - handing off to shell');

// ── Shells on the consoles ──────────────────────────────────────────────────────
// A shell runs on every console that is shown and not used by a program, like getty: on the first console at boot,
// on another one when it is switched to (Alt+1 … Alt+9, chvt), and again on the visible console when a program that
// used it ends. A program may run on another console (child_process.spawn with { stdio: tty.console(n) }); no shell
// starts there while it does. `exit` in the shell of another console than the first clears that console and shows
// the first one; the next shell starts there when it is shown again. On the first console a new shell starts at once.

const FIRST_CONSOLE = 0;

/** The TTY ids of the consoles whose shell the OS started and that still runs. */
const shells = new Set<number>();

/** Start a shell on console `index` if no program uses it. */
function ensureShell(index: number): void {
    let tty = jobs.console(index);
    if (jobs.inUse(tty)) return;
    try {
        spawn('/rom/bin/bash', [], { stdio: tty });
        shells.add(tty.handle.getId());
    } catch (error: any) {
        tty.stderr.write(jobs.formatError('/rom/bin/bash.js', error) + '\n');
    }
}

/** The console with the TTY `id`, or -1. */
function consoleOf(id: number): number {
    for (let i = 0; i < screen.getConsoleCount(); i++) {
        if (screen.getConsole(i).getId() === id) return i;
    }
    return -1;
}

events.on('console_show', (index: number) => ensureShell(index));
events.on('tty_released', (id: number) => {
    let index = consoleOf(id);
    if (index < 0) return;
    // The OS's shell holds its console as long as it runs, so the console is released when the shell ended (`exit`).
    if (shells.delete(id) && index !== FIRST_CONSOLE) {
        jobs.console(index).stdout.write(CSI.reset + CSI.clearScreen + CSI.home);
        if (screen.getVisible() === index) screen.show(FIRST_CONSOLE);
        return;
    }
    if (screen.getVisible() === index) ensureShell(index);
});

// // Run the user startup script if one exists; silently skip if absent.
// if (fs.existsSync('/startup.js') || fs.existsSync('/startup')) os.run('/startup');

ensureShell(screen.getVisible());
