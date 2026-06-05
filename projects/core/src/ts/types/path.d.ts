// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `path` — path logic split out of `fs` (Node `path` style).

interface PathModule {
    /** Join path segments with separators. Replaces the old `fs.combine`. */
    join(...parts: string[]): string;
    /** Final segment of a path. Replaces the old `fs.getName`. */
    basename(path: string, ext?: string): string;
    /** Parent directory of a path. Replaces the old `fs.getDir`. */
    dirname(path: string): string;
    /** File extension (including the leading dot), or `""`. */
    extname(path: string): string;
    /** Resolve segments into an absolute path (against the current directory). */
    resolve(...parts: string[]): string;
    /** Path separator (`"/"`). */
    readonly sep: string;
}
