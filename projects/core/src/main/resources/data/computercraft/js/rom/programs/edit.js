// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// A simple text editor — a port of the CC Lua `edit` program, adapted to this
// runtime:
//   - Events use os.on/os.off listeners rather than an os.pullEvent loop.
//   - Syntax highlighting is a small self-contained JavaScript tokenizer applied
//     per line (the Lua version reuses CC's Lua lexer with cross-line state).
//   - Autocomplete completes global/member names instead of using
//     textutils.complete against the Lua environment.

import colours from "/rom/apis/colours.js";

const KEYWORDS = new Set([
    "await", "async", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends", "false",
    "finally", "for", "from", "function", "get", "if", "import", "in", "instanceof",
    "let", "new", "null", "of", "return", "set", "static", "super", "switch",
    "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while",
    "with", "yield",
]);

export default async function edit(shell, ...args) {
    if (args.length === 0) {
        print("Usage: edit <path>");
        return;
    }

    let sPath = shell.resolve(args[0]);
    const bReadOnly = fs.isReadOnly(sPath);
    if (fs.exists(sPath) && fs.isDir(sPath)) {
        print("Cannot edit a directory.");
        return;
    }

    // Create files with the default extension if none was given.
    if (!fs.exists(sPath) && !sPath.includes(".")) {
        const sExtension = settings.get("edit.default_extension");
        if (sExtension !== "" && typeof sExtension === "string") sPath += "." + sExtension;
    }

    let x = 1, y = 1;
    let [w, h] = term.getSize();
    let scrollX = 0, scrollY = 0;
    let tLines = [];

    // Colours
    const isColour = term.isColour();
    const bgColour = colours.black;
    const textColour = colours.white;
    const highlightColour = isColour ? colours.yellow : colours.white;
    const keywordColour = isColour ? colours.yellow : colours.white;
    const errorColour = isColour ? colours.red : colours.white;
    const stringColour = isColour ? colours.red : textColour;
    const commentColour = isColour ? colours.green : colours.lightGrey;
    const numberColour = isColour ? colours.magenta : textColour;

    // ── Menu ────────────────────────────────────────────────────────────────
    const canRun = shell && typeof shell.run === "function";
    let printer = null;
    try { printer = (await peripheral.find("printer"))[0] ?? null; } catch (_) { /* none */ }

    const menuItems = [];
    if (!bReadOnly) menuItems.push("Save");
    if (canRun) menuItems.push("Run");
    if (printer) menuItems.push("Print");
    menuItems.push("Exit");

    let currentMenu = null; // { selected } or null
    let menuBounds = [];

    // ── Status ──────────────────────────────────────────────────────────────
    let statusOk = true;
    let statusText = "";
    const setStatus = (text, ok) => { statusOk = ok !== false; statusText = text; };

    if (bReadOnly) {
        setStatus("File is read only", false);
    } else if (fs.getFreeSpace(sPath) < 1024) {
        setStatus("Disk is low on space", false);
    } else {
        let message = isColour ? "Press Ctrl or click here to access menu" : "Press Ctrl to access menu";
        if (message.length > w - 5) message = "Press Ctrl for menu";
        setStatus(message);
    }

    // ── File I/O ──────────────────────────────────────────────────────────────
    const load = () => {
        tLines = [];
        if (fs.exists(sPath)) {
            const file = fs.open(sPath, "r");
            if (file) {
                let line;
                while ((line = file.readLine()) !== null) tLines.push(line);
                file.close();
            }
        }
        if (tLines.length === 0) tLines.push("");
    };

    // Returns [ok, fileError].
    const save = (path, fWrite) => {
        const dir = path.slice(0, path.length - fs.getName(path).length);
        if (!fs.exists(dir)) fs.makeDir(dir);

        let file = null, fileErr = null, ok = true;
        try {
            const res = fs.open(path, "w");
            if (Array.isArray(res)) { file = res[0]; fileErr = res[1]; } else file = res;
            if (file) fWrite(file);
            else throw new Error("Failed to open " + path);
        } catch (e) {
            ok = false;
            if (!fileErr) fileErr = String(e && e.message ? e.message : e);
        }
        if (file) file.close();
        return [ok, fileErr];
    };

    // ── Autocomplete ──────────────────────────────────────────────────────────
    let tCompletions;
    let nCompletion;

    const completeIdentifier = (frag) => {
        const parts = frag.split(".");
        const last = parts.pop();
        let obj = globalThis;
        for (const p of parts) {
            if (obj === null || obj === undefined) return null;
            obj = obj[p];
        }
        if (obj === null || obj === undefined) return null;
        const names = new Set();
        try { for (const k of Object.keys(obj)) names.add(k); } catch (_) { /* opaque */ }
        const results = [];
        for (const name of names) {
            if (name.length > last.length && name.startsWith(last)) results.push(name.slice(last.length));
        }
        results.sort();
        return results.length > 0 ? results : null;
    };

    const complete = (sLine) => {
        if (!settings.get("edit.autocomplete")) return null;
        const m = sLine.match(/[A-Za-z0-9_.$]+$/);
        if (!m || m[0].length === 0) return null;
        return completeIdentifier(m[0]);
    };

    const recomplete = () => {
        const sLine = tLines[y - 1];
        if (!bReadOnly && x === sLine.length + 1) {
            tCompletions = complete(sLine);
            nCompletion = (tCompletions && tCompletions.length > 0) ? 0 : undefined;
        } else {
            tCompletions = undefined;
            nCompletion = undefined;
        }
    };

    const writeCompletion = () => {
        if (nCompletion !== undefined) {
            const sCompletion = tCompletions[nCompletion];
            term.setTextColor(colours.white);
            term.setBackgroundColor(colours.grey);
            term.write(sCompletion);
            term.setTextColor(textColour);
            term.setBackgroundColor(bgColour);
        }
    };

    // ── Highlighting ──────────────────────────────────────────────────────────
    // Char-code based tokenizer (regex-per-char is far too slow on the
    // interpreter-only JS engine), batching runs of similar characters and only
    // scanning the visible window — so the cost is bounded by the screen width
    // rather than the line length. This keeps a single redraw well within the
    // computer's time budget even for very long lines.
    const isDigit = (c) => c >= 48 && c <= 57;
    const isIdentStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
    const isIdentPart = (c) => isIdentStart(c) || isDigit(c);
    const isSpecialStart = (text, k, limit) => {
        const c = text.charCodeAt(k);
        return isIdentStart(c) || isDigit(c) || c === 34 || c === 39 || c === 96
            || (c === 47 && (text.charCodeAt(k + 1) === 47 || text.charCodeAt(k + 1) === 42))
            || (c === 46 && isDigit(text.charCodeAt(k + 1)));
    };

    // `text` is the already-clipped visible slice of a line (length <= width),
    // so the whole of it is highlighted.
    const highlightLine = (text) => {
        const segs = [];
        const n = text.length;
        const limit = n;
        let i = 0;
        while (i < limit) {
            const c = text.charCodeAt(i);

            if (c === 47 && text.charCodeAt(i + 1) === 47) { // line comment //
                segs.push([text.slice(i, limit), commentColour]);
                break;
            }
            if (c === 47 && text.charCodeAt(i + 1) === 42) { // block comment /* */
                let end = text.indexOf("*/", i + 2);
                end = (end === -1 || end + 2 > limit) ? limit : end + 2;
                segs.push([text.slice(i, end), commentColour]);
                i = end;
                continue;
            }
            if (c === 34 || c === 39 || c === 96) { // string / template
                let j = i + 1;
                while (j < limit) {
                    const d = text.charCodeAt(j);
                    if (d === 92) { j += 2; continue; }
                    if (d === c) { j++; break; }
                    j++;
                }
                segs.push([text.slice(i, j), stringColour]);
                i = j;
                continue;
            }
            if (isDigit(c) || (c === 46 && isDigit(text.charCodeAt(i + 1)))) { // number
                let j = i + 1;
                while (j < limit) {
                    const d = text.charCodeAt(j);
                    if (isIdentPart(d) || d === 46) j++;
                    else break;
                }
                segs.push([text.slice(i, j), numberColour]);
                i = j;
                continue;
            }
            if (isIdentStart(c)) { // identifier / keyword
                let j = i + 1;
                while (j < limit && isIdentPart(text.charCodeAt(j))) j++;
                const word = text.slice(i, j);
                segs.push([word, KEYWORDS.has(word) ? keywordColour : textColour]);
                i = j;
                continue;
            }
            // Batch a run of plain characters into one segment.
            let j = i + 1;
            while (j < limit && !isSpecialStart(text, j, limit)) j++;
            segs.push([text.slice(i, j), textColour]);
            i = j;
        }
        return segs;
    };

    // ── Drawing ───────────────────────────────────────────────────────────────
    const redrawLines = (line, endLine) => {
        if (endLine === undefined) endLine = line;
        let colour = term.getTextColour();
        for (let ln = line; ln <= endLine && ln - scrollY < h; ln++) {
            if (ln < 1) continue;
            const contents = tLines[ln - 1];
            if (contents === undefined) break;

            term.setCursorPos(1, ln - scrollY);
            term.clearLine();

            // Only highlight and draw the horizontally-visible part of the line,
            // so the work is bounded by the screen width, not the line length.
            const visible = contents.length > scrollX ? contents.slice(scrollX, scrollX + w) : "";
            for (const [text, segColour] of highlightLine(visible)) {
                if (segColour !== colour) { term.setTextColour(segColour); colour = segColour; }
                term.write(text);
            }

            if (ln === y && x === contents.length + 1) {
                writeCompletion();
                colour = term.getTextColour();
            }
        }
        term.setTextColour(textColour);
        term.setCursorPos(x - scrollX, y - scrollY);
    };

    const redrawText = () => redrawLines(scrollY + 1, scrollY + h - 1);

    const redrawMenu = () => {
        term.setCursorPos(1, h);
        term.clearLine();

        // Line number, right-aligned.
        const lnText = "Ln " + y;
        term.setCursorPos(w - lnText.length + 1, h);
        term.setTextColour(highlightColour);
        term.write("Ln ");
        term.setTextColour(textColour);
        term.write(String(y));

        term.setCursorPos(1, h);
        if (currentMenu) {
            menuBounds = [];
            let cxp = 1;
            for (let idx = 0; idx < menuItems.length; idx++) {
                const selected = idx === currentMenu.selected;
                const label = selected ? "[" + menuItems[idx] + "]" : " " + menuItems[idx] + " ";
                term.setCursorPos(cxp, h);
                if (selected) {
                    term.setTextColour(highlightColour);
                    term.write(label);
                    term.setTextColour(textColour);
                } else {
                    term.write(label);
                }
                menuBounds.push({ start: cxp, end: cxp + label.length - 1, item: menuItems[idx] });
                cxp += label.length;
            }
        } else {
            term.setTextColour(statusOk ? highlightColour : errorColour);
            term.write(statusText);
            term.setTextColour(textColour);
        }

        term.setCursorPos(x - scrollX, y - scrollY);
        term.setCursorBlink(!currentMenu);
    };

    // ── Cursor ────────────────────────────────────────────────────────────────
    const setCursor = (newX, newY) => {
        const oldY = y;
        x = newX;
        y = newY;
        let screenX = x - scrollX;
        let screenY = y - scrollY;

        let bRedraw = false;
        if (screenX < 1) { scrollX = x - 1; screenX = 1; bRedraw = true; }
        else if (screenX > w) { scrollX = x - w; screenX = w; bRedraw = true; }

        if (screenY < 1) { scrollY = y - 1; screenY = 1; bRedraw = true; }
        else if (screenY > h - 1) { scrollY = y - (h - 1); screenY = h - 1; bRedraw = true; }

        recomplete();
        if (bRedraw) redrawText();
        else if (y !== oldY) redrawLines(Math.min(y, oldY), Math.max(y, oldY));
        else redrawLines(y);

        redrawMenu();
    };

    const acceptCompletion = () => {
        if (nCompletion !== undefined) {
            const sCompletion = tCompletions[nCompletion];
            tLines[y - 1] = tLines[y - 1] + sCompletion;
            setCursor(x + sCompletion.length, y);
        }
    };

    // ── Menu actions ──────────────────────────────────────────────────────────
    let quit;

    const menuFuncs = {
        Save: () => {
            if (bReadOnly) {
                setStatus("Access denied", false);
            } else {
                const [ok, fileErr] = save(sPath, (file) => {
                    for (const sLine of tLines) file.write(sLine + "\n");
                });
                if (ok) setStatus("Saved to " + sPath);
                else setStatus(fileErr ? "Error saving: " + fileErr : "Error saving to " + sPath, false);
            }
            redrawMenu();
        },
        Exit: () => { quit(); },
        Run: async () => {
            let title = fs.getName(sPath).replace(/\.js$/, "");
            const tempPath = bReadOnly
                ? ".temp." + title + ".js"
                : fs.combine(fs.getDir(sPath), ".temp." + title + ".js");
            if (fs.exists(tempPath)) { setStatus("Error saving to " + tempPath, false); redrawMenu(); return; }

            const [ok] = save(tempPath, (file) => file.write(tLines.join("\n")));
            if (!ok) { setStatus("Error saving to " + tempPath, false); redrawMenu(); return; }

            // Detach our listeners while the program runs, then restore the editor.
            detach();
            term.setCursorBlink(false);
            term.clear();
            term.setCursorPos(1, 1);
            try {
                await shell.run(tempPath);
            } catch (_) { /* program error already reported by the shell */ }
            fs.delete(tempPath);

            attach();
            term.setBackgroundColour(bgColour);
            term.clear();
            redrawText();
            redrawMenu();
        },
        Print: async () => {
            if (!printer) { setStatus("No printer attached", false); redrawMenu(); return; }
            if (await printer.getInkLevel() < 1) { setStatus("Printer out of ink", false); redrawMenu(); return; }
            if (await printer.getPaperLevel() < 1) { setStatus("Printer out of paper", false); redrawMenu(); return; }

            const name = fs.getName(sPath);
            const [pw, ph] = await printer.getPageSize();
            let nPage = 0;

            const newPage = async () => {
                while (!(await printer.newPage())) {
                    setStatus("Printer output full / out of supplies, please service", false);
                    redrawMenu();
                    await sleep(0.5);
                }
                nPage++;
                await printer.setPageTitle(nPage === 1 ? name : name + " (page " + nPage + ")");
            };

            await newPage();
            let row = 1;
            for (const sLine of tLines) {
                // Wrap long lines to the page width.
                let rest = sLine.length === 0 ? [""] : [];
                for (let i = 0; i < sLine.length; i += pw) rest.push(sLine.slice(i, i + pw));
                for (const chunk of rest) {
                    if (row > ph) { await newPage(); row = 1; }
                    await printer.setCursorPos(1, row);
                    await printer.write(chunk);
                    row++;
                }
            }
            await printer.endPage();

            setStatus("Printed " + nPage + " Page" + (nPage > 1 ? "s" : ""));
            redrawMenu();
        },
    };

    const menuActivate = (item) => {
        currentMenu = null;
        redrawMenu();
        const f = menuFuncs[item];
        if (f) f();
    };

    // ── Event handlers ────────────────────────────────────────────────────────
    let done = false;
    const handlers = {};
    const attach = () => { for (const name of Object.keys(handlers)) os.on(name, handlers[name]); };
    const detach = () => { for (const name of Object.keys(handlers)) os.off(name, handlers[name]); };

    handlers.key = (key) => {
        if (done) return;
        if (currentMenu) {
            if (key === keys.left) {
                currentMenu.selected = (currentMenu.selected - 1 + menuItems.length) % menuItems.length;
                redrawMenu();
            } else if (key === keys.right) {
                currentMenu.selected = (currentMenu.selected + 1) % menuItems.length;
                redrawMenu();
            } else if (key === keys.enter || key === keys.numPadEnter) {
                menuActivate(menuItems[currentMenu.selected]);
            } else if (key === keys.leftCtrl || key === keys.rightCtrl) {
                currentMenu = null;
                redrawMenu();
            }
            return;
        }

        if (key === keys.up) {
            if (nCompletion !== undefined) {
                nCompletion -= 1;
                if (nCompletion < 0) nCompletion = tCompletions.length - 1;
                redrawLines(y);
            } else if (y > 1) {
                setCursor(Math.min(x, tLines[y - 2].length + 1), y - 1);
            }
        } else if (key === keys.down) {
            if (nCompletion !== undefined) {
                nCompletion += 1;
                if (nCompletion >= tCompletions.length) nCompletion = 0;
                redrawLines(y);
            } else if (y < tLines.length) {
                setCursor(Math.min(x, tLines[y].length + 1), y + 1);
            }
        } else if (key === keys.tab && !bReadOnly) {
            if (nCompletion !== undefined && x === tLines[y - 1].length + 1) {
                acceptCompletion();
            } else {
                const sLine = tLines[y - 1];
                tLines[y - 1] = sLine.slice(0, x - 1) + "    " + sLine.slice(x - 1);
                setCursor(x + 4, y);
            }
        } else if (key === keys.pageUp) {
            const newY = y - (h - 1) >= 1 ? y - (h - 1) : 1;
            setCursor(Math.min(x, tLines[newY - 1].length + 1), newY);
        } else if (key === keys.pageDown) {
            const newY = y + (h - 1) <= tLines.length ? y + (h - 1) : tLines.length;
            setCursor(Math.min(x, tLines[newY - 1].length + 1), newY);
        } else if (key === keys.home) {
            if (x > 1) setCursor(1, y);
        } else if (key === keys.end) {
            const nLimit = tLines[y - 1].length + 1;
            if (x < nLimit) setCursor(nLimit, y);
        } else if (key === keys.left) {
            if (x > 1) setCursor(x - 1, y);
            else if (y > 1) setCursor(tLines[y - 2].length + 1, y - 1);
        } else if (key === keys.right) {
            const nLimit = tLines[y - 1].length + 1;
            if (x < nLimit) setCursor(x + 1, y);
            else if (nCompletion !== undefined && x === tLines[y - 1].length + 1) acceptCompletion();
            else if (x === nLimit && y < tLines.length) setCursor(1, y + 1);
        } else if (key === keys.delete && !bReadOnly) {
            const nLimit = tLines[y - 1].length + 1;
            if (x < nLimit) {
                const sLine = tLines[y - 1];
                tLines[y - 1] = sLine.slice(0, x - 1) + sLine.slice(x);
                recomplete();
                redrawLines(y);
            } else if (y < tLines.length) {
                tLines[y - 1] = tLines[y - 1] + tLines[y];
                tLines.splice(y, 1);
                recomplete();
                redrawText();
            }
        } else if (key === keys.backspace && !bReadOnly) {
            if (x > 1) {
                const sLine = tLines[y - 1];
                if (x > 4 && sLine.slice(x - 5, x - 1) === "    " && !/\S/.test(sLine.slice(0, x - 1))) {
                    tLines[y - 1] = sLine.slice(0, x - 5) + sLine.slice(x - 1);
                    setCursor(x - 4, y);
                } else {
                    tLines[y - 1] = sLine.slice(0, x - 2) + sLine.slice(x - 1);
                    setCursor(x - 1, y);
                }
            } else if (y > 1) {
                const prevLen = tLines[y - 2].length;
                tLines[y - 2] = tLines[y - 2] + tLines[y - 1];
                tLines.splice(y - 1, 1);
                setCursor(prevLen + 1, y - 1);
                redrawText();
            }
        } else if ((key === keys.enter || key === keys.numPadEnter) && !bReadOnly) {
            const sLine = tLines[y - 1];
            const m = sLine.match(/^ +/);
            const spaces = m ? m[0].length : 0;
            tLines[y - 1] = sLine.slice(0, x - 1);
            tLines.splice(y, 0, " ".repeat(spaces) + sLine.slice(x - 1));
            setCursor(spaces + 1, y + 1);
            redrawText();
        } else if (key === keys.leftCtrl || key === keys.rightCtrl) {
            currentMenu = { selected: 0 };
            redrawMenu();
        }
    };

    handlers.char = (param) => {
        if (done) return;
        if (currentMenu) {
            const ch = param.toLowerCase();
            const idx = menuItems.findIndex((it) => it[0].toLowerCase() === ch);
            if (idx >= 0) { currentMenu.selected = idx; menuActivate(menuItems[idx]); }
            return;
        }
        if (bReadOnly) return;
        const sLine = tLines[y - 1];
        tLines[y - 1] = sLine.slice(0, x - 1) + param + sLine.slice(x - 1);
        setCursor(x + 1, y);
    };

    handlers.paste = (text) => {
        if (done || bReadOnly) return;
        if (currentMenu) { currentMenu = null; redrawMenu(); }
        const sLine = tLines[y - 1];
        tLines[y - 1] = sLine.slice(0, x - 1) + text + sLine.slice(x - 1);
        setCursor(x + text.length, y);
    };

    handlers.mouse_click = (button, cx, cy) => {
        if (done) return;
        if (currentMenu) {
            if (cy === h) {
                const b = menuBounds.find((b) => cx >= b.start && cx <= b.end);
                if (b) menuActivate(b.item);
            }
            return;
        }
        if (button === 1) {
            if (cy < h) {
                const newY = Math.min(Math.max(scrollY + cy, 1), tLines.length);
                const newX = Math.min(Math.max(scrollX + cx, 1), tLines[newY - 1].length + 1);
                setCursor(newX, newY);
            } else {
                currentMenu = { selected: 0 };
                redrawMenu();
            }
        }
    };

    handlers.mouse_scroll = (direction) => {
        if (done || currentMenu) return;
        if (direction === -1) {
            if (scrollY > 0) { scrollY -= 1; redrawText(); }
        } else if (direction === 1) {
            const nMaxScroll = tLines.length - (h - 1);
            if (scrollY < nMaxScroll) { scrollY += 1; redrawText(); }
        }
    };

    handlers.term_resize = () => {
        if (done) return;
        [w, h] = term.getSize();
        setCursor(x, y);
        term.clear();
        redrawMenu();
        redrawText();
    };

    handlers.terminate = () => { quit(); };

    // ── Run ─────────────────────────────────────────────────────────────────
    load();

    term.setBackgroundColour(bgColour);
    term.clear();
    term.setCursorPos(x, y);
    term.setCursorBlink(true);

    recomplete();
    redrawText();
    redrawMenu();

    await new Promise((resolve) => {
        quit = () => {
            if (done) return;
            done = true;
            detach();
            resolve();
        };
        attach();
    });

    // Cleanup
    term.clear();
    term.setCursorBlink(false);
    term.setCursorPos(1, 1);
}
