// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// time — the time of day in the world (12-hour clock) and the day.

import system from 'system';

/** `hours` (0–24, as system.time() returns it) as "h:mm AM". */
function formatTime(hours: number): string {
    let minutes = Math.floor(hours * 60) % (24 * 60);
    let h = Math.floor(minutes / 60);
    let m = minutes % 60;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function main(): void {
    console.log(`The time is ${formatTime(system.time())} on Day ${system.day()}`);
}
