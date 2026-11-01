// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/vi/registers.ts — where yanked and deleted text goes, as in vim:
//
//   "        the unnamed register: what was yanked or deleted last (p puts it)
//   "0       the last yank (without a register given)
//   "1 – "9  deletions of a line or more, newest first (each one shifts the others down)
//   "-       the last small deletion (within a line)
//   "a – "z  named registers; "A – "Z append to them
//   "_       the black hole: writing to it keeps everything else as it is

/** A register's text (lines joined with '\n'), and whether it holds whole lines or a block (a column of text). */
export interface Register {
    text: string;
    linewise: boolean;
    block?: boolean;
}

export class Registers {
    #registers = new Map<string, Register>();
    /** The register the unnamed one stands for: the one written last. */
    #unnamed: Register | undefined;

    /** Register `name` ('"' or none: the unnamed one), or undefined if it is empty or unknown. */
    get(name = '"'): Register | undefined {
        if (name === '"') return this.#unnamed;
        return this.#registers.get(name.toLowerCase());
    }

    /** Yanked text: into register `name`, or "0 without one. */
    yank(name: string | undefined, value: Register): void {
        if (name === '_') return;
        this.#write(name ?? '0', value);
    }

    /** Deleted text: into register `name`, or "1 (shifting "1–"8 down) for a line or more, "- for less. */
    delete(name: string | undefined, value: Register): void {
        if (name === '_') return;
        if (name !== undefined && name !== '"') {
            this.#write(name, value);
            return;
        }
        if (value.linewise || value.text.indexOf('\n') >= 0) {
            for (let i = 9; i > 1; i--) {
                let previous = this.#registers.get(String(i - 1));
                if (previous !== undefined) this.#registers.set(String(i), previous);
            }
            this.#write('1', value);
        } else {
            this.#write('-', value);
        }
    }

    #write(name: string, value: Register): void {
        let key = name.toLowerCase();
        let entry = value;
        if (name >= 'A' && name <= 'Z') {
            let old = this.#registers.get(key);
            if (old !== undefined) {
                // Appending a whole line to text (or text to lines) makes the result whole lines, as in vim.
                let joined = old.linewise || value.linewise ? old.text + '\n' + value.text : old.text + value.text;
                entry = { text: joined, linewise: old.linewise || value.linewise };
            }
        }
        this.#registers.set(key, entry);
        this.#unnamed = entry;
    }
}

/** Whether `name` is a register vi knows ("x before a command). */
export function isRegisterName(name: string): boolean {
    return /^["0-9a-zA-Z_-]$/.test(name);
}
