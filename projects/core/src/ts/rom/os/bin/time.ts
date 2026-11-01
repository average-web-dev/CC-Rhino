// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// time — the time of day in the world (12-hour clock) and the day.

import system from 'system';

export function main(): void {
    console.log(`The time is ${system.formatTime()} on Day ${system.day()}`);
}
