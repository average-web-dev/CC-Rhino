// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

import colors from "/rom/apis/colors.js";

export default async function ls(shell, ...args) {
    const path = args[0] ? shell.resolve(args[0]) : shell.dir();
    let files;
    try {
        files = fs.list(path);
    } catch (e) {
        print(`ls: ${path}: ${e}`);
        return;
    }

    if (!files || files.length === 0) return;

    const [w] = term.getSize();
    const isColor = term.isColour && term.isColour();

    // Calculate column width
    const maxLen = Math.max(...files.map(f => f.length));
    const colW = maxLen + 2;
    const cols = Math.max(1, Math.floor(w / colW));

    let col = 0;
    for (const name of files.sort()) {
        const isDir = fs.isDir && fs.isDir(`${path}/${name}`);
        if (isColor) term.setTextColour(isDir ? colors.cyan : colors.white);
        write(name.padEnd(cols > 1 ? colW : 0));
        col++;
        if (col >= cols) {
            print("");
            col = 0;
        }
    }
    if (col > 0) print("");
    if (isColor) term.setTextColour(colors.white);
}
