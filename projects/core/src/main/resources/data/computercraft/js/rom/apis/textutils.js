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

function tabulate(...rows) {
    const [w] = term.getSize();
    for (const row of rows) {
        if (!row || !Array.isArray(row)) { print(""); continue; }
        const cols = Math.max(1, Math.floor(w / Math.max(...row.map(c => String(c ?? "").length + 2), 1)));
        let line = "";
        for (const cell of row) {
            const s = String(cell ?? "");
            line += s.padEnd(Math.ceil(w / row.length));
        }
        print(line.slice(0, w));
    }
}

function slowPrint(text, rate = 20) {
    // In a real implementation this would use os.sleep; simplified here
    print(text);
}

function urlEncode(str) {
    return encodeURIComponent(String(str));
}

export default { serialize, unserialize, formatTime, tabulate, slowPrint, urlEncode };
