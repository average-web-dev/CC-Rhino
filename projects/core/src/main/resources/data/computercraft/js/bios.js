// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

// ── print / write ─────────────────────────────────────────────────────────────
globalThis.print = (...args) => {
    const line = args.map(a => a == null ? "nil" : String(a)).join("\t");
    // getCursorPos() returns [x, y]; CC coordinates are 1-based
    const pos = term.getCursorPos();
    const y   = Array.isArray(pos) ? pos[1] : 1;
    term.setCursorPos(1, y);   // column 1 = leftmost visible column
    term.write(line);
    term.setCursorPos(1, y + 1);
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
os.once("__start__", async () => {
    print("CC: Tweaked JS Edition");

    // Load /startup.js if it exists on the computer's disk
    try {
        const mod = await import("/startup.js");
        if (mod && typeof mod.default === "function") {
            await mod.default();
        }
    } catch (e) {
        // File not found or parse error — show message but keep running
        if (!String(e).includes("No such file")) {
            print("startup.js error: " + e);
        }
    }
});
