// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

export default async function help(shell, topic) {
    if (!topic) {
        print("Usage: help <topic>");
        print("Available: colors, keys, fs, os, term, turtle, peripheral");
        print("           ls, clear, echo, id, reboot, shutdown");
        return;
    }

    const paths = [
        `/rom/help/${topic}.txt`,
        `/rom/help/${topic}.md`,
    ];

    for (const p of paths) {
        if (fs.exists(p)) {
            try {
                const h = fs.open(p, "r");
                if (!h) { print(`help: Cannot open ${p}`); return; }
                let line;
                while ((line = h.readLine()) !== null) {
                    print(line);
                }
                h.close();
                return;
            } catch (e) {
                print(`help: ${e}`);
                return;
            }
        }
    }

    print(`help: No help for "${topic}"`);
}
