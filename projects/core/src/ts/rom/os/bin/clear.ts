// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// clear — clear the terminal and move the cursor to the top left.

export function main(): void {
    process.stdout.cursorTo(0, 0);
    process.stdout.clearScreenDown();
}
