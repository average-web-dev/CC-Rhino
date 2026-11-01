// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/view.ts — draws a vi Editor on a Term: the text rows (tabs expanded, '~' past the end of the
// file, the Visual selection highlighted), then the last row (the command line, a message, or the mode and the cursor
// position). Only rows that changed since the last draw are written, so typing does not repaint the whole screen.

import { ColorIndex, type Term } from '/rom/lib/term';
import type { Editor } from '/rom/lib/internal/vi/editor';
import { displayCol, expandTabs } from '/rom/lib/internal/vi/tabs';

/** What a row shows: its text, its color, and the screen columns [from, to) that are highlighted (selected). */
interface Row {
    text: string;
    color: ColorIndex;
    from: number;
    to: number;
}

const MODES: Record<string, string> = {
    insert: '-- INSERT --', replace: '-- REPLACE --', char: '-- VISUAL --', line: '-- VISUAL LINE --',
    block: '-- VISUAL BLOCK --',
};

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
                let [from, to] = this.#highlight(line);
                from = Math.max(0, Math.min(from - editor.left, width));
                to = Math.max(from, Math.min(to - editor.left, width));
                rows.push({ text: text.padEnd(width), color: ColorIndex.WHITE, from, to });
            } else {
                rows.push({ text: '~'.padEnd(width), color: ColorIndex.BLUE, from: 0, to: 0 });
            }
        }
        rows.push(this.#lastRow(width));

        term.setCursorBlink(false);
        let selectedBack = term.isColor() ? ColorIndex.LIGHT_GRAY : ColorIndex.WHITE;
        for (let y = 0; y < rows.length; y++) {
            let row = rows[y];
            let old = this.#rows[y];
            if (old !== undefined && old.text === row.text && old.color === row.color && old.from === row.from
                && old.to === row.to) {
                continue;
            }
            term.setCursorPos({ x: 0, y });
            term.setTextColor(row.color);
            if (row.from >= row.to) {
                term.write(row.text);
                continue;
            }
            term.write(row.text.slice(0, row.from));
            term.setTextColor(ColorIndex.BLACK);
            term.setBackgroundColor(selectedBack);
            term.write(row.text.slice(row.from, row.to));
            term.setTextColor(row.color);
            term.setBackgroundColor(ColorIndex.BLACK);
            term.write(row.text.slice(row.to));
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

    /** The screen columns [from, to) of `line` the Visual selection covers ([0, 0) if none). */
    #highlight(line: number): [number, number] {
        let editor = this.#editor;
        let selection = editor.selection();
        if (selection === undefined || line < selection.start.line || line > selection.end.line) return [0, 0];
        let text = editor.buffer.line(line);
        // A selected line break shows as one cell after the text.
        let width = displayCol(text, text.length);
        switch (selection.kind) {
            case 'line':
                return [0, width + 1];
            case 'block':
                if (selection.right === Infinity) return [selection.left, Math.max(width, selection.left + 1)];
                return [selection.left, selection.right + 1];
            default: {
                let from = line === selection.start.line ? displayCol(text, selection.start.col) : 0;
                let end = selection.end.col;
                let to = line !== selection.end.line || end >= text.length ? width + 1 : displayCol(text, end + 1);
                return [from, to];
            }
        }
    }

    /** The command line, a message, or the mode and where the cursor is. */
    #lastRow(width: number): Row {
        let editor = this.#editor;
        if (editor.mode === 'command') {
            let text = ':' + editor.command;
            let shown = text.slice(Math.max(0, text.length - width + 1)).padEnd(width);
            return { text: shown, color: ColorIndex.WHITE, from: 0, to: 0 };
        }
        let pending = editor.pendingKeys === '' ? '' : editor.pendingKeys.slice(-10) + '  ';
        let position = `${editor.cursor.line + 1},${editor.cursor.col + 1}`;
        let ruler = `${pending}${editor.buffer.modified ? '[+] ' : ''}${position}`;
        let mode = editor.mode === 'visual' ? editor.visual!.kind : editor.mode;
        let left = editor.message !== '' ? editor.message : MODES[mode] ?? '';
        if (editor.message !== '' && editor.message.length > width - ruler.length - 1) {
            let color = editor.error ? ColorIndex.RED : ColorIndex.WHITE;
            return { text: left.slice(0, width).padEnd(width), color, from: 0, to: 0 };
        }
        let room = width - ruler.length - 1;
        let color = editor.error ? ColorIndex.RED : ColorIndex.WHITE;
        return { text: left.slice(0, room).padEnd(room) + ' ' + ruler, color, from: 0, to: 0 };
    }
}
