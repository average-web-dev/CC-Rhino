// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// reboot — restart the computer.

import system from 'system';

export function main(): void {
    console.log('Goodbye');
    system.reboot();
}
