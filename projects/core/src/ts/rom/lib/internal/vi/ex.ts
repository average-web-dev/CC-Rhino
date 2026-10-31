// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/ex.ts — the commands typed after ':' in vi.
//
//   :w [file]   write (to another file: that one; the first name given becomes the buffer's)
//   :q  :q!     quit (refused with unsaved changes, unless !)
//   :wq :x      write and quit (:x only writes if there are changes)
//   :<n>  :$    go to line n / the last line

import type { Editor } from '/rom/lib/internal/vi/editor';

/** Run the command line `line` (without the ':'). */
export function execute(editor: Editor, line: string): void {
    let text = line.trim();
    if (text === '') return;
    if (/^\d+$/.test(text)) { editor.gotoLine(parseInt(text, 10) - 1); return; }
    if (text === '$') { editor.gotoLine(editor.buffer.lineCount - 1); return; }

    let match = /^([a-zA-Z]+)(!?)\s*(.*)$/.exec(text);
    if (match === null) { editor.fail(`E492: Not an editor command: ${text}`); return; }
    let [, name, bang, arg] = match;
    let force = bang === '!';
    let file = arg === '' ? undefined : arg;
    switch (name) {
        case 'w': case 'write':
            editor.write(file ?? editor.path);
            return;
        case 'q': case 'quit':
            if (!force && editor.buffer.modified) {
                editor.fail('E37: No write since last change (add ! to override)');
                return;
            }
            editor.quit = true;
            return;
        case 'wq': case 'x': case 'xit': case 'exit':
            if ((name === 'wq' || editor.buffer.modified || file !== undefined) && !editor.write(file ?? editor.path)) return;
            editor.quit = true;
            return;
        default:
            editor.fail(`E492: Not an editor command: ${text}`);
    }
}
