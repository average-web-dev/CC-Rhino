// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/view.ts — draws a vi Editor on a Term: the text rows (tabs expanded, '~' past the end of the
// file), then the last row (the command line, a message, or the mode and the cursor position). Only rows that changed
// since the last draw are written, so typing does not repaint the whole screen.

import { ColorIndex, type Term } from '/rom/lib/term';
import { displayCol, expandTabs, type Editor } from '/rom/lib/internal/vi/editor';

/** What a row shows: its text and its colors (one of each per cell kind, enough for now). */
interface Row {
    text: string;
    color: ColorIndex;
}

export class View {
    readonly #term: Term;
    readonly #editor: Editor;
    #rows: Row[] = [];
    #width = -1;

    constructor(term: Term, editor: Editor) {
        this.#term = term;
        this.#editor = editor;
    }

    /** Forget what is on screen, so the next draw writes every row. */
    invalidate(): void {
        this.#rows = [];
    }

    draw(): void {
        let term = this.#term;
        let editor = this.#editor;
        let { width, height } = term.getSize();
        if (width !== this.#width || this.#rows.length !== height) {
            this.#width = width;
            this.invalidate();
        }
        editor.setSize(width, height - 1);

        let rows: Row[] = [];
        for (let y = 0; y < height - 1; y++) {
            let line = editor.top + y;
            if (line < editor.buffer.lineCount) {
                let text = expandTabs(editor.buffer.line(line)).slice(editor.left, editor.left + width);
                rows.push({ text: text.padEnd(width), color: ColorIndex.WHITE });
            } else {
                rows.push({ text: '~'.padEnd(width), color: ColorIndex.BLUE });
            }
        }
        rows.push(this.#lastRow(width));

        term.setCursorBlink(false);
        for (let y = 0; y < rows.length; y++) {
            let row = rows[y];
            let old = this.#rows[y];
            if (old !== undefined && old.text === row.text && old.color === row.color) continue;
            term.setCursorPos({ x: 0, y });
            term.setTextColor(row.color);
            term.write(row.text);
        }
        term.setTextColor(ColorIndex.WHITE);
        this.#rows = rows;

        if (editor.mode === 'command') {
            term.setCursorPos({ x: Math.min(width - 1, 1 + editor.command.length), y: height - 1 });
        } else {
            let x = displayCol(editor.buffer.line(editor.cursor.line), editor.cursor.col) - editor.left;
            term.setCursorPos({ x, y: editor.cursor.line - editor.top });
        }
        term.setCursorBlink(true);
    }

    /** The command line, a message, or the mode and where the cursor is. */
    #lastRow(width: number): Row {
        let editor = this.#editor;
        if (editor.mode === 'command') {
            let text = ':' + editor.command;
            return { text: text.slice(Math.max(0, text.length - width + 1)).padEnd(width), color: ColorIndex.WHITE };
        }
        let ruler = `${editor.buffer.modified ? '[+] ' : ''}${editor.cursor.line + 1},${editor.cursor.col + 1}`;
        let left = editor.message !== '' ? editor.message : editor.mode === 'insert' ? '-- INSERT --' : '';
        if (editor.message !== '' && editor.message.length > width - ruler.length - 1) {
            return { text: left.slice(0, width).padEnd(width), color: editor.error ? ColorIndex.RED : ColorIndex.WHITE };
        }
        let room = width - ruler.length - 1;
        let color = editor.error ? ColorIndex.RED : ColorIndex.WHITE;
        return { text: left.slice(0, room).padEnd(room) + ' ' + ruler, color };
    }
}
