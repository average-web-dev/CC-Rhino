// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/buffer.ts — the text of an editor, with undo and redo.
//
// The text is a list of lines; a position is a line and a column (0-based; a column may be the line's length, the end).
// Every change is an insertion or a deletion between two positions, recorded with its inverse. Changes made between
// begin() and end() form one undo step (vi's Insert mode, from entering it to Esc, is one); a change outside such a
// group is a step of its own. Each step remembers the cursor before and after it, so undo and redo can put it back.

/** A place in the text: line and column, both from 0. */
export interface Position {
    readonly line: number;
    readonly col: number;
}

/** One change: at `start`, `removed` was replaced by `inserted` (either may be empty; lines joined with '\n'). */
interface Edit {
    start: Position;
    removed: string;
    inserted: string;
}

/** An undo step: its changes, in order, and the cursor before and after them. */
interface Step {
    edits: Edit[];
    before: Position;
    after: Position;
}

/** Whether `a` comes before `b`. */
export function before(a: Position, b: Position): boolean {
    return a.line < b.line || (a.line === b.line && a.col < b.col);
}

/** The position after `text` inserted at `start`. */
function endOf(start: Position, text: string): Position {
    let parts = text.split('\n');
    if (parts.length === 1) return { line: start.line, col: start.col + text.length };
    return { line: start.line + parts.length - 1, col: parts[parts.length - 1].length };
}

export class TextBuffer {
    #lines: string[];
    #undo: Step[] = [];
    #redo: Step[] = [];
    #group: Step | null = null;
    /** The undo depth at the last save (-1: never matches, the text differs from any saved state). */
    #saved = 0;

    constructor(text = '') {
        this.#lines = text.split('\n');
    }

    /** The whole text, lines joined with '\n'. */
    text(): string {
        return this.#lines.join('\n');
    }

    get lineCount(): number {
        return this.#lines.length;
    }

    /** Line `i` (an empty string past the end). */
    line(i: number): string {
        return this.#lines[i] ?? '';
    }

    /** Whether the text changed since it was loaded or saved (undoing back to that state makes it unmodified again). */
    get modified(): boolean {
        return this.#saved !== this.#undo.length || this.#group !== null && this.#group.edits.length > 0;
    }

    /** The text was saved as it is now. */
    markSaved(): void {
        this.#saved = this.#undo.length;
    }

    /** `pos` moved into the text: an existing line, a column from 0 to the line's length. */
    clamp(pos: Position): Position {
        let line = Math.max(0, Math.min(pos.line, this.#lines.length - 1));
        return { line, col: Math.max(0, Math.min(pos.col, this.#lines[line].length)) };
    }

    /** The text from `start` to `end` (exclusive). */
    slice(start: Position, end: Position): string {
        if (start.line === end.line) return this.#lines[start.line].slice(start.col, end.col);
        let parts = [this.#lines[start.line].slice(start.col)];
        for (let i = start.line + 1; i < end.line; i++) parts.push(this.#lines[i]);
        parts.push(this.#lines[end.line].slice(0, end.col));
        return parts.join('\n');
    }

    /** Insert `text` (lines joined with '\n') at `pos`; returns the position after it. */
    insert(pos: Position, text: string, cursor: Position = pos): Position {
        if (text === '') return pos;
        this.#apply({ start: pos, removed: '', inserted: text }, cursor);
        return endOf(pos, text);
    }

    /** Delete from `start` to `end` (exclusive); returns the deleted text. */
    delete(start: Position, end: Position, cursor: Position = start): string {
        let removed = this.slice(start, end);
        if (removed !== '') this.#apply({ start, removed, inserted: '' }, cursor);
        return removed;
    }

    /** Start an undo step (until end()): the changes until then are undone together. */
    begin(cursor: Position): void {
        if (this.#group === null) this.#group = { edits: [], before: cursor, after: cursor };
    }

    /** End the undo step started by begin(), with the cursor after it. */
    end(cursor: Position): void {
        let group = this.#group;
        if (group === null) return;
        this.#group = null;
        if (group.edits.length === 0) return;
        group.after = cursor;
        this.#push(group);
    }

    /** Undo the last step; returns where the cursor goes, or undefined if there is nothing to undo. */
    undo(): Position | undefined {
        this.end(this.#group?.before ?? { line: 0, col: 0 });
        let step = this.#undo.pop();
        if (step === undefined) return undefined;
        for (let i = step.edits.length - 1; i >= 0; i--) {
            let edit = step.edits[i];
            this.#replace(edit.start, endOf(edit.start, edit.inserted), edit.removed);
        }
        this.#redo.push(step);
        return this.clamp(step.before);
    }

    /** Redo the last undone step; returns where the cursor goes, or undefined if there is nothing to redo. */
    redo(): Position | undefined {
        let step = this.#redo.pop();
        if (step === undefined) return undefined;
        for (let edit of step.edits) this.#replace(edit.start, endOf(edit.start, edit.removed), edit.inserted);
        this.#undo.push(step);
        return this.clamp(step.after);
    }

    #apply(edit: Edit, cursor: Position): void {
        this.#replace(edit.start, endOf(edit.start, edit.removed), edit.inserted);
        this.#redo = [];
        if (this.#group !== null) {
            this.#group.edits.push(edit);
        } else {
            this.#push({ edits: [edit], before: cursor, after: cursor });
        }
    }

    #push(step: Step): void {
        // A save state that was undone and then changed differently can no longer be reached.
        if (this.#saved > this.#undo.length) this.#saved = -1;
        this.#undo.push(step);
    }

    /** Replace the text from `start` to `end` with `text`, without recording it. */
    #replace(start: Position, end: Position, text: string): void {
        let head = this.#lines[start.line].slice(0, start.col);
        let tail = this.#lines[end.line].slice(end.col);
        let parts = (head + text + tail).split('\n');
        this.#lines.splice(start.line, end.line - start.line + 1, ...parts);
    }
}
