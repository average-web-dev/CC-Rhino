// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

const term = require('term');

function print(...args: unknown[]): void {
    const text = args.map(String).join('\t');
    term.write(text);
    const { y } = term.getCursorPos();
    const { height } = term.getSize();
    if (y + 1 >= height) {
        term.scroll(1);
        term.setCursorPos({ x: 0, y: height - 1 });
    } else {
        term.setCursorPos({ x: 0, y: y + 1 });
    }
}

// Bootstrap: try to load the user's startup script.
// A missing startup is silently ignored; real errors are re-thrown.
try {
    require("/startup");
} catch (e: unknown) {
    const msg: string = (e as any)?.message ?? String(e);
    if (!msg.startsWith("MODULE_NOT_FOUND")) throw e;
}
