// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/index.ts — OS init layer ("kernel")
// Responsibilities: boot log, device detection, PATH setup, shell handoff.
// Everything after this (aliases, autorun, completion) is bash's or future layers' job.

import system from 'system';
import util   from 'util';

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

/**
 * Format an error as a single `file:line: message` line. The location is taken from the first stack frame outside
 * the module loader, as errors created with `new Error()` carry no fileName/lineNumber of their own.
 */
function formatError(fallbackFile: string, e: any): string {
    const msg = e?.message ?? String(e);
    const frames = String(e?.stack ?? '').split('\n');
    for (let frame of frames) {
        let m = /^\s*at (.+?):(\d+)(?: \(.*\))?$/.exec(frame);
        if (m && m[1] !== 'require-setup.js') return `${m[1]}:${m[2]}: ${msg}`;
    }
    return `${fallbackFile}: ${msg}`;
}

// ── Shell handoff ──────────────────────────────────────────────────────────────
try {

    const bash = require('/rom/bin/bash') as {
        run(path: string, ...args: string[]): boolean;
        start(): void;
    };

    // // Run the user startup script if one exists; silently skip if absent.
    // if (fs.existsSync('/startup.js') || fs.existsSync('/startup')) {
    //     bash.run('/startup');
    // }

    bash.start();
} catch (error: any) {
    console.error(formatError('/rom/bin/bash.js', error));
}
