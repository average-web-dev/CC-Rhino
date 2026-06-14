// SPDX-FileCopyrightText: 2026 average-web-dev
// SPDX-License-Identifier: MPL-2.0

// /rom/os/bin/echo.ts — print arguments separated by spaces.
//
// Variable expansion ($VAR) is performed by the shell before echo runs, so by
// the time we get here the arguments are already the resolved values.

function main(args: string[]): void {
    print(args.join(' '));
}

export = {
    main,
}
