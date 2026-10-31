// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/edit.ts — full-screen text editor.
//
//   edit <path>   — open (or create) a file for editing.
//
// Interactive program model: main() reads keys from process.stdin (in raw mode)
// through a Term and draws with it, until the editor exits. Esc opens the menu
// (Save / Exit; arrows to select, Enter to invoke); Ctrl+S saves, Ctrl+Q exits.
//
// MVP scope: load/edit/save plaintext, scrolling, paste, resize. Syntax
// highlighting (term.blit) and require-name tab completion are follow-ups
// (JS_MIGRATION Phase 11.28).

import fs     from 'fs';
import { Term, KeyName } from '/rom/lib/term';

/** Shortcuts: the letter pressed with Ctrl (Node key names of letters are the lower-case letter). */
const SHORTCUT_SAVE = 's', SHORTCUT_QUIT = 'q';

// CC colour values (powers of two).
const WHITE = 1, GREY = 128, LIGHT_GREY = 256, BLACK = 32768;

/** Normalise `p` to an absolute path, resolving against `cwd` and collapsing `.`/`..`. */
function resolve(p: string, cwd: string): string {
    if (!p.startsWith('/')) p = (cwd === '/' ? '' : cwd) + '/' + p;
    const out: string[] = [];
    for (let seg of p.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') out.pop(); else out.push(seg);
    }
    return '/' + out.join('/');
}

export function main(args: string[], cwd: string): void {
    if (!args[0]) { console.error('Usage: edit <path>'); return; }
    const path = resolve(args[0], cwd ?? '/');
    const term = new Term();
    const canColor = term.isColor();

    // ── Document + view state ───────────────────────────────────────────────────
    let lines: string[] = [''];
    let cx = 0, cy = 0;          // caret: column within line, line index (0-based)
    let scrollX = 0, scrollY = 0;
    let modified = false;
    let running = true;
    let menuOpen = false;
    let menuSel = 0;
    let status = '';

    function load(): void {
        try {
            if (fs.existsSync(path)) {
                let content = fs.readFileSync(path, 'utf8');
                lines = content.split('\n');
                if (lines.length === 0) lines = [''];
            }
        } catch (e: any) {
            status = 'Could not read: ' + (e?.message ?? String(e));
        }
    }

    function save(): void {
        try {
            fs.writeFileSync(path, lines.join('\n'));
            modified = false;
            status = 'Saved ' + path;
        } catch (e: any) {
            status = 'Error: ' + (e?.message ?? String(e));
        }
    }

    const MENU = [
        { label: 'Save', action: () => { save(); } },
        { label: 'Exit', action: () => { running = false; } },
    ];

    // ── Rendering ───────────────────────────────────────────────────────────────

    /** Keep the caret inside the visible window, scrolling if needed. */
    function follow(): void {
        const { width, height } = term.getSize();
        const editHeight = height - 1;
        if (cy < scrollY) scrollY = cy;
        else if (cy >= scrollY + editHeight) scrollY = cy - editHeight + 1;
        if (cx < scrollX) scrollX = cx;
        else if (cx >= scrollX + width) scrollX = cx - width + 1;
    }

    function pad(s: string, width: number): string {
        return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
    }

    function drawBar(width: number, height: number): void {
        term.setCursorPos({ x: 0, y: height - 1 });
        term.setBackgroundColor(canColor ? LIGHT_GREY : BLACK);
        term.setTextColor(canColor ? BLACK : WHITE);
        if (menuOpen) {
            let s = ' ';
            for (let i = 0; i < MENU.length; i++) {
                s += i === menuSel ? `[${MENU[i].label}]` : ` ${MENU[i].label} `;
                s += ' ';
            }
            term.write(pad(s, width));
        } else {
            let left = `${modified ? '*' : ' '}${path}`;
            let right = `${cy + 1}:${cx + 1}`;
            let text = status !== '' ? status : `${left}`;
            let room = Math.max(0, width - right.length - 1);
            term.write(pad(text, room) + ' ' + right);
        }
        term.setBackgroundColor(BLACK);
        term.setTextColor(WHITE);
    }

    function draw(): void {
        const { width, height } = term.getSize();
        const editHeight = height - 1;
        term.setBackgroundColor(BLACK);
        term.setTextColor(WHITE);
        for (let row = 0; row < editHeight; row++) {
            term.setCursorPos({ x: 0, y: row });
            let line = lines[scrollY + row] ?? '';
            term.write(pad(line.slice(scrollX, scrollX + width), width));
        }
        drawBar(width, height);
        if (menuOpen) {
            term.setCursorBlink(false);
        } else {
            term.setCursorPos({ x: cx - scrollX, y: cy - scrollY });
            term.setCursorBlink(true);
        }
    }

    /** Re-scroll + redraw after a state change. */
    function refresh(): void { follow(); draw(); }

    // ── Editing operations ──────────────────────────────────────────────────────

    function insertText(text: string): void {
        const parts = text.split('\n');
        const line = lines[cy];
        if (parts.length === 1) {
            lines[cy] = line.slice(0, cx) + text + line.slice(cx);
            cx += text.length;
        } else {
            let tail = line.slice(cx);
            lines[cy] = line.slice(0, cx) + parts[0];
            let inserted = parts.slice(1);
            let last = inserted.length - 1;
            cx = inserted[last].length;
            inserted[last] += tail;
            lines = lines.slice(0, cy + 1).concat(inserted, lines.slice(cy + 1));
            cy += parts.length - 1;
        }
        modified = true;
        refresh();
    }

    function enter(): void {
        const line = lines[cy];
        const tail = line.slice(cx);
        lines[cy] = line.slice(0, cx);
        lines.splice(cy + 1, 0, tail);
        cy++; cx = 0;
        modified = true;
        refresh();
    }

    function backspace(): void {
        if (cx > 0) {
            let line = lines[cy];
            lines[cy] = line.slice(0, cx - 1) + line.slice(cx);
            cx--;
        } else if (cy > 0) {
            let prev = lines[cy - 1];
            cx = prev.length;
            lines[cy - 1] = prev + lines[cy];
            lines.splice(cy, 1);
            cy--;
        } else return;
        modified = true;
        refresh();
    }

    function del(): void {
        const line = lines[cy];
        if (cx < line.length) {
            lines[cy] = line.slice(0, cx) + line.slice(cx + 1);
        } else if (cy < lines.length - 1) {
            lines[cy] = line + lines[cy + 1];
            lines.splice(cy + 1, 1);
        } else return;
        modified = true;
        refresh();
    }

    // ── Caret movement ──────────────────────────────────────────────────────────

    function moveVertical(dir: number): void {
        const ny = cy + dir;
        if (ny < 0 || ny >= lines.length) return;
        cy = ny;
        cx = Math.min(cx, lines[cy].length);
        refresh();
    }

    function moveLeft(): void {
        if (cx > 0) cx--;
        else if (cy > 0) { cy--; cx = lines[cy].length; }
        refresh();
    }

    function moveRight(): void {
        if (cx < lines[cy].length) cx++;
        else if (cy < lines.length - 1) { cy++; cx = 0; }
        refresh();
    }

    function pageMove(dir: number): void {
        const editHeight = term.getSize().height - 1;
        cy = Math.max(0, Math.min(lines.length - 1, cy + dir * editHeight));
        cx = Math.min(cx, lines[cy].length);
        refresh();
    }

    // ── Input ───────────────────────────────────────────────────────────────────

    function onMenuKey(key: Key): void {
        switch (key.name) {
            case KeyName.LEFT:  menuSel = (menuSel - 1 + MENU.length) % MENU.length; draw(); break;
            case KeyName.RIGHT: menuSel = (menuSel + 1) % MENU.length; draw(); break;
            case KeyName.RETURN: case KeyName.ENTER:
                menuOpen = false;
                MENU[menuSel].action();
                if (running) draw();
                break;
            case KeyName.ESCAPE:
                menuOpen = false; status = ''; draw();
                break;
        }
    }

    function onKey(key: Key): void {
        if (key.name === KeyName.ESCAPE) { menuOpen = !menuOpen; menuSel = 0; status = ''; draw(); return; }
        if (menuOpen) { onMenuKey(key); return; }

        status = '';
        if (key.ctrl && key.name === SHORTCUT_SAVE) { save(); draw(); return; }
        if (key.ctrl && key.name === SHORTCUT_QUIT) { running = false; return; }
        switch (key.name) {
            case KeyName.UP:        moveVertical(-1); return;
            case KeyName.DOWN:      moveVertical(1); return;
            case KeyName.LEFT:      moveLeft(); return;
            case KeyName.RIGHT:     moveRight(); return;
            case KeyName.HOME:      cx = 0; refresh(); return;
            case KeyName.END:       cx = lines[cy].length; refresh(); return;
            case KeyName.PAGE_UP:   pageMove(-1); return;
            case KeyName.PAGE_DOWN: pageMove(1); return;
            case KeyName.BACKSPACE: backspace(); return;
            case KeyName.DELETE:    del(); return;
            case KeyName.RETURN: case KeyName.ENTER: enter(); return;
            case KeyName.TAB:       insertText('  '); return;
        }
        // A printable character (typed or pasted).
        let ch = key.sequence;
        if (!key.ctrl && !key.meta && ch.length === 1 && ch >= ' ' && ch !== '\x7f') insertText(ch);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    load();
    process.stdin.setRawMode(true);
    term.clear();
    draw();

    // Ctrl+T makes the read throw "Terminated"; the finally still restores the terminal.
    try {
        while (running) {
            let key = term.readKey();
            if (key === undefined) break;
            onKey(key);
        }
    } finally {
        term.setBackgroundColor(BLACK);
        term.setTextColor(WHITE);
        term.clear();
        term.setCursorPos({ x: 0, y: 0 });
        term.setCursorBlink(true);
    }
}
