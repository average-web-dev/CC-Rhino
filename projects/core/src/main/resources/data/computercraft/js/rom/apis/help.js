// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Find help files on the current computer — mirrors the CC Lua help API.

let searchPath = "/rom/help";

const extensions = ["", ".md", ".txt"];

function expectString(i, v) {
    if (typeof v !== "string") throw new Error(`bad argument #${i} (string expected, got ${type(v)})`);
}

// The colon-separated list of directories where help files are searched for.
function path() {
    return searchPath;
}

// Sets the colon-separated help search path.
function setPath(newPath) {
    expectString(1, newPath);
    searchPath = newPath;
}

// Returns the path to the help file for the given topic, or null if not found.
function lookup(topic) {
    expectString(1, topic);
    for (const dir of searchPath.split(":").filter(Boolean)) {
        const base = fs.combine(dir, topic);
        for (const extension of extensions) {
            const file = base + extension;
            if (fs.exists(file) && !fs.isDir(file)) return file;
        }
    }
    return null;
}

// Returns an alphabetically sorted list of all available help topics.
function topics() {
    const items = new Set(["index"]);

    for (const dir of searchPath.split(":").filter(Boolean)) {
        if (fs.isDir(dir)) {
            for (let file of fs.list(dir)) {
                if (file.startsWith(".")) continue;
                if (fs.isDir(fs.combine(dir, file))) continue;
                // Strip a trailing .md/.txt extension.
                for (let i = 1; i < extensions.length; i++) {
                    const extension = extensions[i];
                    if (file.length > extension.length && file.endsWith(extension)) {
                        file = file.slice(0, -extension.length);
                    }
                }
                items.add(file);
            }
        }
    }

    return [...items].sort();
}

// Returns a list of topic endings matching the prefix (for use with read).
function completeTopic(text) {
    expectString(1, text);
    const results = [];
    for (const topic of topics()) {
        if (topic.length > text.length && topic.startsWith(text)) {
            results.push(topic.slice(text.length));
        }
    }
    return results;
}

export default { path, setPath, lookup, topics, completeTopic };
