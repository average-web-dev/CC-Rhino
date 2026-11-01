// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/view.ts — draws a vi Editor on a Term: the text rows (line numbers in front with 'number' /
// 'relativenumber', tabs expanded, '~' past the end of the file, the Visual selection and the matches of the last
// search ('hlsearch') highlighted), then the last row (the command line, a message, or the mode and the cursor
// position). Only rows that changed since the last draw are written, so typing does not repaint the whole screen.

import { ColorIndex, type Term } from '/rom/lib/term';
import type { Editor } from '/rom/lib/internal/vi/editor';
import { compile, matchesOn } from '/rom/lib/internal/vi/search';
import { displayCol, expandTabs } from '/rom/lib/internal/vi/tabs';

/** A run of cells in one color. */
interface Segment {
    text: string;
    fg: ColorIndex;
    bg: ColorIndex;
}

/** A row: its segments, and a key to compare it with what is on screen. */
interface Row {
    segments: Segment[];
    key: string;
}

const MODES: Record<string, string> = {
    insert: '-- INSERT --', replace: '-- REPLACE --', char: '-- VISUAL --', line: '-- VISUAL LINE --',
    block: '-- VISUAL BLOCK --',
};

/** How a cell looks: plain, a search match, or selected. */
const PLAIN = 0, MATCH = 1, SELECTED = 2;

function row(segments: Segment[]): Row {
    return { segments, key: segments.map((s) => `${s.fg},${s.bg}:${s.text}`).join('|') };
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
        let color = term.isColor();
        let gutter = editor.gutter();
        let regex = editor.highlight && editor.options.hlsearch && editor.lastSearch !== undefined
            ? compile(editor.lastSearch.pattern, editor.options) : undefined;

        let rows: Row[] = [];
        for (let y = 0; y < height - 1; y++) {
            let line = editor.top + y;
            if (line >= editor.buffer.lineCount) {
                let fg = color ? ColorIndex.BLUE : ColorIndex.WHITE;
                rows.push(row([{ text: '~'.padEnd(width), fg, bg: ColorIndex.BLACK }]));
                continue;
            }
            let segments: Segment[] = [];
            if (gutter > 0) {
                let number = editor.options.relativenumber && line !== editor.cursor.line
                    ? Math.abs(line - editor.cursor.line) : line + 1;
                let fg = color ? ColorIndex.YELLOW : ColorIndex.WHITE;
                segments.push({ text: String(number).padStart(gutter - 1) + ' ', fg, bg: ColorIndex.BLACK });
            }
            segments.push(...this.#textSegments(line, width - gutter, typeof regex === 'string' ? undefined : regex,
                color));
            rows.push(row(segments));
        }
        rows.push(this.#lastRow(width));

        term.setCursorBlink(false);
        for (let y = 0; y < rows.length; y++) {
            let next = rows[y];
            if (this.#rows[y]?.key === next.key) continue;
            term.setCursorPos({ x: 0, y });
            for (let segment of next.segments) {
                term.setTextColor(segment.fg);
                term.setBackgroundColor(segment.bg);
                term.write(segment.text);
            }
        }
        term.setTextColor(ColorIndex.WHITE);
        term.setBackgroundColor(ColorIndex.BLACK);
        this.#rows = rows;

        if (editor.mode === 'command') {
            term.setCursorPos({ x: Math.min(width - 1, 1 + editor.command.length), y: height - 1 });
        } else {
            let x = displayCol(editor.buffer.line(editor.cursor.line), editor.cursor.col) - editor.left + gutter;
            term.setCursorPos({ x, y: editor.cursor.line - editor.top });
        }
        term.setCursorBlink(true);
    }

    /** The cells of `line` shown in `width` columns, in runs of the same look. */
    #textSegments(line: number, width: number, regex: RegExp | undefined, color: boolean): Segment[] {
        let editor = this.#editor;
        let source = editor.buffer.line(line);
        let text = expandTabs(source).slice(editor.left, editor.left + width).padEnd(width);
        let looks = new Array<number>(width).fill(PLAIN);
        let mark = (from: number, to: number, look: number) => {
            for (let x = Math.max(0, from - editor.left); x < Math.min(width, to - editor.left); x++) looks[x] = look;
        };
        if (regex !== undefined) {
            for (let [start, end] of matchesOn(regex, source)) {
                mark(displayCol(source, start), displayCol(source, Math.max(end, start + 1)), MATCH);
            }
        }
        let [from, to] = this.#selected(line);
        mark(from, to, SELECTED);

        let segments: Segment[] = [];
        let start = 0;
        for (let x = 1; x <= width; x++) {
            if (x < width && looks[x] === looks[start]) continue;
            let look = looks[start];
            let fg = look === PLAIN ? ColorIndex.WHITE : ColorIndex.BLACK;
            let bg = look === SELECTED ? (color ? ColorIndex.LIGHT_GRAY : ColorIndex.WHITE)
                : look === MATCH ? (color ? ColorIndex.YELLOW : ColorIndex.WHITE) : ColorIndex.BLACK;
            segments.push({ text: text.slice(start, x), fg, bg });
            start = x;
        }
        return segments;
    }

    /** The screen columns [from, to) of `line` the Visual selection covers ([0, 0) if none). */
    #selected(line: number): [number, number] {
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
        let plain = (text: string, fg: ColorIndex = ColorIndex.WHITE) =>
            row([{ text: text.padEnd(width).slice(0, width), fg, bg: ColorIndex.BLACK }]);
        if (editor.mode === 'command') {
            let text = editor.prompt + editor.command;
            return plain(text.slice(Math.max(0, text.length - width + 1)));
        }
        let pending = editor.pendingKeys === '' ? '' : editor.pendingKeys.slice(-10) + '  ';
        let position = `${editor.cursor.line + 1},${editor.cursor.col + 1}`;
        let ruler = `${pending}${editor.buffer.modified ? '[+] ' : ''}${position}`;
        let mode = editor.mode === 'visual' ? editor.visual!.kind : editor.mode;
        let left = editor.message !== '' ? editor.message : MODES[mode] ?? '';
        let fg = editor.error ? ColorIndex.RED : ColorIndex.WHITE;
        if (editor.message !== '' && editor.message.length > width - ruler.length - 1) return plain(left, fg);
        let room = width - ruler.length - 1;
        return plain(left.slice(0, room).padEnd(room) + ' ' + ruler, fg);
    }
}
