// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/vi.ts — a modal text editor like vi / vim (#10).
//
//   vi [file]     edit a file (or a new, unnamed buffer: :w name writes it)
//
// Normal mode moves and changes text, Insert mode (i, a, o …) types it, ':' runs commands (:w, :q, :wq, :q!). The
// editor itself is /rom/lib/internal/vi; this program connects it to the terminal, event driven as a Node program
// is: main() puts stdin in raw mode with bracketed paste and mouse reports, listens to its 'keydown' / 'paste' /
// 'mouse' events (and stdout's 'resize') and returns. The flowing stdin keeps the program alive until the editor
// quits: then the listeners are removed, stdin pauses and the TTY is put back as it was.

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

    /** Apply an input to the editor, then redraw, or close when it quit (also when the change failed). */
    let update = (change: () => void): void => {
        try {
            change();
        } catch (e) {
            close();
            throw e;
        }
        if (editor.quit) close(); else view.draw();
    };
    let onKey = (key: TtyKeyInput) => { update(() => { editor.handleKey(key); }); };
    let onPaste = (paste: TtyPasteInput) => { update(() => { editor.handlePaste(paste.text); }); };
    let onMouse = (mouse: TtyMouseInput) => { update(() => { editor.handleMouse(mouse); }); };
    let onResize = () => { update(() => { view.invalidate(); }); };

    /** Stop listening (so the program can end) and give the TTY back as the shell expects it. */
    let close = (): void => {
        stdin.off('keydown', onKey);
        stdin.off('paste', onPaste);
        stdin.off('mouse', onMouse);
        stdout.off('resize', onResize);
        stdin.pause();
        stdout.write(CSI.mouse(false) + CSI.bracketedPaste(false));
        stdin.setRawMode(false);
        term.clear();
        term.setCursorPos({ x: 0, y: 0 });
        term.setCursorBlink(true);
    };

    stdin.setRawMode(true);
    stdout.write(CSI.bracketedPaste(true) + CSI.mouse(true));
    term.clear();
    view.draw();
    stdin.on('keydown', onKey);
    stdin.on('paste', onPaste);
    stdin.on('mouse', onMouse);
    stdout.on('resize', onResize);
}
