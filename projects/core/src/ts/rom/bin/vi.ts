// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/vi.ts — a modal text editor like vi / vim (#10).
//
//   vi [file]     edit a file (or a new, unnamed buffer: :w name writes it)
//
// Normal mode moves and changes text, Insert mode (i, a, o …) types it, ':' runs commands (:w, :q, :wq, :q!). The
// editor itself is /rom/lib/internal/vi; this program connects it to the terminal, event driven as a Node program
// is: main() switches to the alternate screen, puts stdin in raw mode with bracketed paste and mouse reports, listens
// to its 'keydown' / 'paste' / 'mouse' events (and stdout's 'resize') and returns. The flowing stdin keeps the
// program alive until the editor quits with process.exit(): the end of the job drops the listeners and puts the TTY
// back as it was (raw mode, mouse and paste off, the shell's screen shown again).

import fs from 'fs';
import { Term } from '/rom/lib/term';
import { CSI } from '/rom/lib/tty';
import { resolve } from '/rom/lib/resolve';
import { Editor, type FileIO } from '/rom/lib/internal/vi/editor';
import { View } from '/rom/lib/internal/vi/view';

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
    let stdin = process.stdin;
    let stdout = process.stdout;

    /** Apply an input to the editor, then redraw, or end the program when it quit. */
    let update = (change: () => void): void => {
        change();
        if (editor.quit) process.exit();
        view.draw();
    };

    stdout.write(CSI.alternateScreen(true) + CSI.bracketedPaste(true) + CSI.mouse(true));
    stdin.setRawMode(true);
    term.clear();
    view.draw();
    stdin.on('keydown', (key) => { update(() => { editor.handleKey(key); }); });
    stdin.on('paste', (paste) => { update(() => { editor.handlePaste(paste.text); }); });
    stdin.on('mouse', (mouse) => { update(() => { editor.handleMouse(mouse); }); });
    stdout.on('resize', () => { update(() => { view.invalidate(); }); });
}
