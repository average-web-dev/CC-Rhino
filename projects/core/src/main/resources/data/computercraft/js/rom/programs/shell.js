// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

import colors from "/rom/apis/colors.js";

// Searches for a program file in the given paths, returns full path or null.
function findProgram(name, searchPath) {
    // Absolute or relative path given directly
    if (name.includes("/")) {
        const p = name.endsWith(".js") ? name : name + ".js";
        if (fs.exists(p)) return p;
        return null;
    }
    // Search path
    for (const dir of searchPath) {
        const candidates = [
            `${dir}/${name}.js`,
            `${dir}/${name}`,
        ];
        for (const p of candidates) {
            if (fs.exists(p)) return p;
        }
    }
    return null;
}

export default async function shell() {
    let dir = "/";
    let running = true;
    const searchPath = ["/rom/programs", "/"];

    const shellAPI = {
        dir: () => dir,
        setDir: (d) => { dir = d.startsWith("/") ? d : `/${d}`; },
        path: () => searchPath.join(":"),
        run: (cmd, ...args) => runProgram(cmd, args),
        exit: () => { running = false; },
        resolve: (p) => p.startsWith("/") ? p : `${dir}/${p}`,
        // Returns a sorted list of program names found across the search path.
        programs: (includeHidden) => {
            const items = new Set();
            for (const entry of searchPath) {
                const d = entry.startsWith("/") ? entry : `/${entry}`;
                if (!(fs.isDir && fs.isDir(d))) continue;
                for (let file of fs.list(d)) {
                    if (fs.isDir(fs.combine(d, file))) continue;
                    if (!includeHidden && file.startsWith(".")) continue;
                    if (file.length > 3 && file.endsWith(".js")) file = file.slice(0, -3);
                    items.add(file);
                }
            }
            return [...items].sort();
        },
    };

    async function runProgram(cmd, args) {
        const path = findProgram(cmd, searchPath);
        if (!path) {
            print(`${cmd}: Command not found`);
            return false;
        }
        try {
            const mod = await import(path);
            if (typeof mod.default !== "function") {
                print(`${cmd}: No default export`);
                return false;
            }
            await mod.default(shellAPI, ...args);
            return true;
        } catch (e) {
            const msg = String(e);
            if (msg.includes("Terminated")) throw e;
            print(`${cmd}: ${msg}`);
            return false;
        }
    }

    // ── Main loop ──────────────────────────────────────────────────────────────
    term.clear();
    term.setCursorPos(1, 1);
    print("CC:Tweaked JS Edition");
    print('Type "help" for help.');
    print("");

    while (running) {
        // Prompt
        const isColor = term.isColour && term.isColour();
        if (isColor) term.setTextColour(colors.yellow);
        write(dir + "> ");
        if (isColor) term.setTextColour(colors.white);

        let line;
        try {
            line = await read();
        } catch (e) {
            if (String(e).includes("Terminated")) break;
            throw e;
        }

        if (!line || !line.trim()) continue;

        const tokens = line.trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
        const cmd = tokens[0];
        const args = tokens.slice(1).map(t => t.replace(/^["']|["']$/g, ""));

        if (!cmd) continue;

        // Built-in: cd
        if (cmd === "cd") {
            const target = args[0] || "/";
            const resolved = target.startsWith("/") ? target : `${dir}/${target}`;
            if (fs.isDir && fs.isDir(resolved)) {
                shellAPI.setDir(resolved);
            } else {
                print(`cd: ${target}: Not a directory`);
            }
            continue;
        }

        try {
            await runProgram(cmd, args);
        } catch (e) {
            if (String(e).includes("Terminated")) break;
            print("Error: " + e);
        }
    }

    print("Goodbye.");
}
