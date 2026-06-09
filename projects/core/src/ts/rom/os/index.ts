// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/index.ts — OS init layer ("kernel")
// Responsibilities: boot log, device detection, PATH setup, shell handoff.
// Everything after this (aliases, autorun, completion) is bash's or future layers' job.

const term   = require('term');
const system = require('system');
const fs     = require('fs');

const canColor = term.isColor();

// ── Kernel log ─────────────────────────────────────────────────────────────────
// Inspired by Linux dmesg / systemd service lines.

const COL_WHITE: Color = 1;
const COL_LIME:  Color = 32;    // [  OK  ]
const COL_RED:   Color = 16384; // [ FAIL ]
const COL_GREY:  Color = 256;   // [      ] info

function klog(level: 'ok' | 'info' | 'fail', msg: string): void {
    const tag = level === 'ok'   ? '[  OK  ] '
              : level === 'fail' ? '[ FAIL ] '
                                 : '[      ] ';
    if (canColor) {
        term.setTextColor(level === 'ok' ? COL_LIME : level === 'fail' ? COL_RED : COL_GREY);
        term.write(tag);
        term.setTextColor(COL_WHITE);
    }
    // print() is the global defined by bios.ts; it writes from current cursor pos then newlines.
    print(canColor ? msg : tag + msg);
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

klog('info', 'CC: Tweaked JS  kernel  v1.21.0');

const device = detectDevice();
klog('ok', `Computer ${system.getComputerID()} - ${device}`);

const label = system.getComputerLabel();
if (label) klog('info', `Label: ${label}`);

require.paths = ['/rom/os/bin', '/rom/bin', '/rom/lib'];
klog('ok', 'Module paths: ' + require.paths.join(', '));

klog('ok', 'Kernel ready - handing off to shell');

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
    // @ts-ignore
} catch (error: any) {
    print(error);
    print(error.filename);
    print(error.lineNumber);
}
