// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

function serialize(val, seen = new Set()) {
    if (val === null || val === undefined) return "nil";
    if (typeof val === "boolean") return String(val);
    if (typeof val === "number") return String(val);
    if (typeof val === "string") return JSON.stringify(val);
    if (Array.isArray(val)) {
        if (seen.has(val)) return "{...}";
        seen.add(val);
        const items = val.map(v => serialize(v, seen)).join(", ");
        seen.delete(val);
        return `{${items}}`;
    }
    if (typeof val === "object") {
        if (seen.has(val)) return "{...}";
        seen.add(val);
        const items = Object.entries(val)
            .map(([k, v]) => `${JSON.stringify(k)} = ${serialize(v, seen)}`)
            .join(", ");
        seen.delete(val);
        return `{${items}}`;
    }
    return tostring(val);
}

function unserialize(str) {
    // Best-effort: try JSON first, then simple nil/true/false/number
    try { return JSON.parse(str); } catch (_) {}
    if (str === "nil") return null;
    if (str === "true") return true;
    if (str === "false") return false;
    const n = Number(str);
    if (!isNaN(n)) return n;
    return null;
}

function formatTime(t, ampm = false) {
    const h = Math.floor(t);
    const m = Math.floor((t % 1) * 60);
    if (ampm) {
        const suffix = h < 12 ? "AM" : "PM";
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
    }
    return `${h}:${String(m).padStart(2, "0")}`;
}

// Print "Press any key to continue" and wait for a keypress, then clear it.
async function pageWait() {
    write("Press any key to continue...");
    await new Promise((resolve) => os.once("key", resolve));
    const cy = term.getCursorPos()[1];
    term.setCursorPos(1, cy);
    term.clearLine();
}

// Shared implementation for tabulate / pagedTabulate. Accepts arrays (rows) and
// numbers (text-colour changes). When `bPaged` is set, it pauses for a keypress
// once the screen fills. Returns a Promise; the non-paged path never awaits, so
// tabulate() completes synchronously.
async function tabulateImpl(bPaged, args) {
    const [w, h] = term.getSize();

    let nMaxLen = w / 8;
    for (const t of args) {
        if (Array.isArray(t)) {
            for (const item of t) {
                const ty = type(item);
                if (ty !== "string" && ty !== "number") {
                    throw new Error(`bad argument (string expected, got ${ty})`);
                }
                nMaxLen = Math.max(tostring(item).length + 1, nMaxLen);
            }
        } else if (typeof t !== "number") {
            throw new Error(`bad argument (number or table expected, got ${type(t)})`);
        }
    }
    nMaxLen = Math.floor(nMaxLen);
    const nCols = Math.max(1, Math.floor(w / nMaxLen));

    // Lay each row out into fixed-width columns, recording the active colour.
    const prev = term.getTextColour();
    let colour = prev;
    const lines = [];
    for (const t of args) {
        if (typeof t === "number") { colour = t; continue; }
        if (!Array.isArray(t) || t.length === 0) continue;

        let line = "";
        let nCol = 0;
        for (const s of t) {
            if (nCol >= nCols) { lines.push({ text: line, colour }); line = ""; nCol = 0; }
            const start = nCol * nMaxLen;
            if (line.length < start) line += " ".repeat(start - line.length);
            line += tostring(s);
            nCol++;
        }
        lines.push({ text: line, colour });
    }

    let shown = term.getCursorPos()[1];
    for (const { text, colour: c } of lines) {
        term.setTextColor(c);
        print(text);
        if (bPaged) {
            shown++;
            if (shown >= h) {
                term.setTextColor(prev);
                await pageWait();
                shown = 1;
            }
        }
    }
    term.setTextColor(prev);
}

// Print tables in a structured form. Arguments are rows (arrays) or colours
// (numbers, which set the colour of subsequent rows).
function tabulate(...args) {
    return tabulateImpl(false, args);
}

// As tabulate, but pauses for input when the output does not fit on screen.
function pagedTabulate(...args) {
    return tabulateImpl(true, args);
}

// Print text, pausing for a keypress when the screen fills. Simplified relative
// to the Lua version (which redirects the terminal's scroll handler).
async function pagedPrint(text, _freeLines) {
    const [, h] = term.getSize();
    let shown = term.getCursorPos()[1];
    const lines = tostring(text).split("\n");
    let printed = 0;
    for (const line of lines) {
        printed += print(line);
        shown += 1;
        if (shown >= h) { await pageWait(); shown = 1; }
    }
    return printed;
}

function slowPrint(text, rate = 20) {
    // In a real implementation this would use os.sleep; simplified here
    print(text);
}

function urlEncode(str) {
    return encodeURIComponent(String(str));
}

export default {
    serialize, unserialize, formatTime,
    tabulate, pagedTabulate, pagedPrint,
    slowPrint, urlEncode,
};
