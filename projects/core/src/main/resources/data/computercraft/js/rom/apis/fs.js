// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Filesystem helpers — mirrors the CC Lua fs API. The native fs methods (open,
// list, isDir, combine, getDir, getDrive, exists, ...) pass straight through via
// a Proxy; this module adds the pure-Lua helpers complete, find and isDriveRoot.

const native = fs;

// Lua-style string.sub: 1-based, inclusive, with a defaulted end of the string.
function luaSub(s, i, j) {
    if (j === undefined || j === null) j = s.length;
    if (i < 1) i = 1;
    if (j > s.length) j = s.length;
    if (i > j) return "";
    return s.slice(i - 1, j);
}

// Index (1-based) of the next "/" or "\" at or after `start`, or null.
function findSlash(s, start) {
    for (let i = start; i <= s.length; i++) {
        const c = s[i - 1];
        if (c === "/" || c === "\\") return i;
    }
    return null;
}

function expectString(i, v) {
    if (typeof v !== "string") throw new Error(`bad argument #${i} (string expected, got ${type(v)})`);
}

// Provides completion for a file or directory name, suitable for use with read.
function complete(sPath, sLocation, bIncludeFiles, bIncludeDirs) {
    expectString(1, sPath);
    expectString(2, sLocation);

    let bIncludeHidden;
    if (type(bIncludeFiles) === "table") {
        const opts = bIncludeFiles;
        bIncludeDirs = opts.include_dirs;
        bIncludeHidden = opts.include_hidden;
        bIncludeFiles = opts.include_files;
    }

    bIncludeHidden = bIncludeHidden !== false;
    bIncludeFiles = bIncludeFiles !== false;
    bIncludeDirs = bIncludeDirs !== false;

    let sDir = sLocation;
    let nStart = 1;
    if (findSlash(sPath, 1) === 1) {
        sDir = "";
        nStart = 2;
    }

    let sName;
    while (sName === undefined) {
        const nSlash = findSlash(sPath, nStart);
        if (nSlash) {
            const sPart = luaSub(sPath, nStart, nSlash - 1);
            sDir = native.combine(sDir, sPart);
            nStart = nSlash + 1;
        } else {
            sName = luaSub(sPath, nStart);
        }
    }

    if (!native.isDir(sDir)) return [];

    const results = [];
    if (bIncludeDirs && sPath === "") results.push(".");
    if (sDir !== "") {
        if (sPath === "") results.push(bIncludeDirs ? ".." : "../");
        else if (sPath === ".") results.push(bIncludeDirs ? "." : "./");
    }

    const nameLen = sName.length;
    for (const sFile of native.list(sDir)) {
        if (sFile.length >= nameLen && sFile.slice(0, nameLen) === sName
            && (bIncludeHidden || sFile[0] !== "." || sName[0] === ".")) {
            const bIsDir = native.isDir(native.combine(sDir, sFile));
            const sResult = sFile.slice(nameLen);
            if (bIsDir) {
                results.push(sResult + "/");
                if (bIncludeDirs && sResult.length > 0) results.push(sResult);
            } else if (bIncludeFiles && sResult.length > 0) {
                results.push(sResult);
            }
        }
    }
    return results;
}

// Convert a single path segment containing * / ? wildcards into an anchored regex.
function partToRegex(part) {
    let re = "^";
    for (const ch of part) {
        if (ch === "*") re += ".*";
        else if (ch === "?") re += ".";
        else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(re + "$");
}

function findAux(path, parts, i, out) {
    const part = parts[i];
    if (!part) {
        if (native.exists(path)) out.push(path);
    } else if (part.exact) {
        findAux(native.combine(path, part.contents), parts, i + 1, out);
    } else {
        if (!native.isDir(path)) return;
        for (const file of native.list(path)) {
            if (part.regex.test(file)) findAux(native.combine(path, file), parts, i + 1, out);
        }
    }
}

// Searches for files matching a path string with wildcards ("*" and "?").
function find(pattern) {
    expectString(1, pattern);

    pattern = native.combine(pattern); // normalise, removing ".."s

    if (pattern === ".." || pattern.slice(0, 3) === "../") {
        throw new Error("/" + pattern + ": Invalid Path");
    }

    if (!/[*?]/.test(pattern)) {
        return native.exists(pattern) ? [pattern] : [];
    }

    const parts = [];
    for (const part of pattern.split("/").filter(Boolean)) {
        if (/[*?]/.test(part)) {
            parts.push({ exact: false, regex: partToRegex(part) });
        } else {
            parts.push({ exact: true, contents: part });
        }
    }

    const out = [];
    findAux("", parts, 0, out);
    return out;
}

// Returns true if a path is mounted to the parent filesystem.
function isDriveRoot(path) {
    expectString(1, path);
    const parent = native.getDir(path);
    if (parent === "..") return true; // force the root directory to be a mount
    const drive = native.getDrive(path);
    return drive !== null && drive !== undefined && drive !== native.getDrive(parent);
}

const base = { complete, find, isDriveRoot };

export default new Proxy(base, {
    get(target, key) {
        if (typeof key !== "string" || key in target) return target[key];
        return native[key];
    },
});
