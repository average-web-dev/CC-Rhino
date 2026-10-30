// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// clear — clear the terminal and move the cursor to the top left.

import { CSI } from '/rom/lib/tty';

export function main(): void {
    process.stdout.write(CSI.clearScreen + CSI.home);
}
