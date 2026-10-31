// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/vi.ts — a modal text editor like vi / vim (#10).
//
//   vi [file]     edit a file (or a new, unnamed buffer: :w name writes it)
//
// Normal mode moves and changes text, Insert mode (i, a, o …) types it, ':' runs commands (:w, :q, :wq, :q!). The
// editor itself is /rom/lib/internal/vi; this program connects it to the terminal: raw mode, bracketed paste, and the
// TTY put back as it was when it ends.

import fs from 'fs';
import { Term } from '/rom/lib/term';
import { CSI } from '/rom/lib/tty';
import { resolve } from '/rom/lib/resolve';
import { Editor, type FileIO } from '/rom/lib/internal/vi/editor';
import { View } from '/rom/lib/internal/vi/view';
import { InputType } from '/rom/lib/internal/keys';

export function main(args: string[], cwd: string): void {
    let io: FileIO = {
        read: (path) => {
            let file = resolve(cwd, path);
            return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
        },
        write: (path, text) => { fs.writeFileSync(resolve(cwd, path), text); },
    };
    let editor = new Editor(io, args[0]);
    let term = new Term();
    let view = new View(term, editor);

    process.stdin.setRawMode(true);
    process.stdout.write(CSI.bracketedPaste(true));
    term.clear();
    try {
        view.draw();
        while (!editor.quit) {
            let input = term.readInput();
            if (input === undefined) break;
            if (input.type === InputType.KEY_DOWN) editor.handleKey(input);
            else if (input.type === InputType.PASTE) editor.handlePaste(input.text);
            else continue;
            if (!editor.quit) view.draw();
        }
    } finally {
        process.stdout.write(CSI.bracketedPaste(false));
        process.stdin.setRawMode(false);
        term.clear();
        term.setCursorPos({ x: 0, y: 0 });
        term.setCursorBlink(true);
    }
}
