// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/bin/edit.ts — full-screen text editor.
//
//   edit <path>   — open (or create) a file for editing.
//
// Interactive program model: main() blocks (spinning on system.yield) while its
// own char/key/paste listeners do the editing, so the parent shell stays parked
// until the editor exits. Press Ctrl to open the menu (Save / Exit), arrows to
// select, Enter to invoke.
//
// MVP scope: load/edit/save plaintext, scrolling, paste, resize. Syntax
// highlighting (term.blit) and require-name tab completion are follow-ups
// (JS_MIGRATION Phase 11.28).

const events = require('events');
const term   = require('term');
const fs     = require('fs');
const system = require('system');

// GLFW key codes (same set used inline by bash.ts).
const K = {
    ENTER: 257, ENTER2: 335, BACKSPACE: 259, DELETE: 261, TAB: 258,
    LEFT: 263, RIGHT: 262, UP: 265, DOWN: 264,
    HOME: 268, END: 269, PAGE_UP: 266, PAGE_DOWN: 267,
    LCTRL: 341, RCTRL: 345, ESCAPE: 256,
};

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

function main(args: string[], cwd: string): void {
    if (!args[0]) { print('Usage: edit <path>'); return; }
    const path = resolve(args[0], cwd ?? '/');
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
                let content = fs.readFileSync(path, 'utf8') as string;
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

    // ── Input handlers ──────────────────────────────────────────────────────────

    function onMenuKey(key: number): void {
        switch (key) {
            case K.LEFT:  menuSel = (menuSel - 1 + MENU.length) % MENU.length; draw(); break;
            case K.RIGHT: menuSel = (menuSel + 1) % MENU.length; draw(); break;
            case K.ENTER: case K.ENTER2:
                menuOpen = false;
                MENU[menuSel].action();
                if (running) draw();
                break;
            case K.ESCAPE:
                menuOpen = false; status = ''; draw();
                break;
        }
    }

    function onKey(key: number, held: boolean): void {
        if (key === K.LCTRL || key === K.RCTRL) {
            if (!held) { menuOpen = !menuOpen; menuSel = 0; status = ''; draw(); }
            return;
        }
        if (menuOpen) { onMenuKey(key); return; }

        status = '';
        switch (key) {
            case K.UP:        moveVertical(-1); break;
            case K.DOWN:      moveVertical(1); break;
            case K.LEFT:      moveLeft(); break;
            case K.RIGHT:     moveRight(); break;
            case K.HOME:      cx = 0; refresh(); break;
            case K.END:       cx = lines[cy].length; refresh(); break;
            case K.PAGE_UP:   pageMove(-1); break;
            case K.PAGE_DOWN: pageMove(1); break;
            case K.BACKSPACE: backspace(); break;
            case K.DELETE:    del(); break;
            case K.ENTER: case K.ENTER2: enter(); break;
            case K.TAB:       insertText('  '); break;
        }
    }

    function onChar(ch: string): void {
        if (menuOpen) return;
        status = '';
        insertText(ch);
    }

    function onPaste(text: string): void {
        if (menuOpen) return;
        status = '';
        insertText(text);
    }

    function onResize(): void { refresh(); }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    load();
    term.clear();
    draw();

    events.on('char', onChar);
    events.on('key', onKey);
    events.on('paste', onPaste);
    events.on('term_resize', onResize);

    // Block here, one tick at a time, while the listeners above drive the editor.
    while (running) system.yield();

    events.off('char', onChar);
    events.off('key', onKey);
    events.off('paste', onPaste);
    events.off('term_resize', onResize);

    // Restore the terminal for the shell.
    term.setBackgroundColor(BLACK);
    term.setTextColor(WHITE);
    term.clear();
    term.setCursorPos({ x: 0, y: 0 });
    term.setCursorBlink(true);
}

export = { main };
