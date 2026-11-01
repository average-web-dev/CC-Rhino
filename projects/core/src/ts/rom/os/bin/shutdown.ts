// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// shutdown — turn the computer off.

import system from 'system';

export function main(): void {
    console.log('Goodbye');
    system.shutdown();
}
