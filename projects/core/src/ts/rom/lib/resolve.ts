// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/resolve.ts — turn a (possibly relative) path into a normalised
// absolute path against a working directory.
//
// The shell now passes arguments through verbatim, so each program resolves its
// own path operands with this helper: `resolve(cwd, arg)`.

function resolve(cwd: string, p: string): string {
    const raw = (p.startsWith('/') ? '' : cwd.replace(/\/$/, '') + '/') + p;
    const out: string[] = [];
    for (let seg of raw.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') out.pop();
        else out.push(seg);
    }
    return '/' + out.join('/');
}

export = resolve;
