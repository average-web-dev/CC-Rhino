// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

// ── Low-level terminal helpers ────────────────────────────────────────────────

globalThis.write = (text) => {
    term.write(String(text ?? ""));
};

globalThis.print = (...args) => {
    const [cx, cy] = term.getCursorPos();
    term.setCursorPos(1, cy);
    term.write(args.map(a => a == null ? "nil" : String(a)).join("\t"));
    const [, ny] = term.getCursorPos();
    term.setCursorPos(1, ny + 1);
};

// ── read() — line input with backspace support ────────────────────────────────
// key codes: 257 = enter, 259 = backspace
globalThis.read = async (replaceChar) => {
    const [x0] = term.getCursorPos();
    let buf = "";
    let done = false;
    let resolve;

    const pending = new Promise(r => { resolve = r; });

    function onChar(ch) {
        if (done) return;
        buf += ch;
        write(replaceChar !== undefined ? replaceChar : ch);
    }

    function onKey(key) {
        if (done) return;
        if (key === 257) {                         // Enter
            done = true;
            os.off("char", onChar);
            os.off("key", onKey);
            const [cx, cy] = term.getCursorPos();
            term.setCursorPos(1, cy + 1);
            term.setCursorBlink(false);
            resolve(buf);
        } else if (key === 259) {                  // Backspace
            if (buf.length > 0) {
                buf = buf.slice(0, -1);
                const [cx, cy] = term.getCursorPos();
                if (cx > x0) {
                    term.setCursorPos(cx - 1, cy);
                    write(" ");
                    term.setCursorPos(cx - 1, cy);
                }
            }
        }
    }

    term.setCursorBlink(true);
    os.on("char", onChar);
    os.on("key", onKey);
    return pending;
};

// ── Lua-compatible shims ──────────────────────────────────────────────────────

globalThis.tostring = (v) => {
    if (v === null || v === undefined) return "nil";
    if (typeof v === "number") return String(v);
    return String(v);
};

globalThis.tonumber = (v, base) => {
    if (v == null) return null;
    const n = base ? parseInt(String(v), base) : Number(v);
    return isNaN(n) ? null : n;
};

globalThis.type = (v) => {
    if (v === null || v === undefined) return "nil";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    if (typeof v === "function") return "function";
    return "table";
};

globalThis.pcall = async (fn, ...args) => {
    try {
        const r = await fn(...args);
        return [true, r];
    } catch (e) {
        return [false, String(e)];
    }
};

globalThis.error = (msg, level) => { throw new Error(msg); };

// ── Bootstrap ─────────────────────────────────────────────────────────────────

os.once("__start__", async () => {
    try {
        // Load standard library APIs
        // Run /startup.js if present (user autostart)
        if (fs.exists("/startup.js")) {
            try {
                const s = await import("/startup.js");
                if (typeof s.default === "function") await s.default();
            } catch (e) {
                print("startup.js error: " + e);
            }
        }

        // Boot the shell
        const shellMod = await import("/rom/programs/shell.js");
        await shellMod.default();

    } catch (e) {
        print("Boot error: " + e);
    }
});
