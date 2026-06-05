// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `process` — computer control & info (the Node `process` analog).
// The old `os` was split into `process`, `events` and global timer functions.

interface ProcessModule {
    /** Shut the computer down. */
    shutdown(): void;
    /** Reboot the computer. */
    reboot(): void;

    getComputerID(): number;
    /** The computer's label, or `null` if none is set. */
    getComputerLabel(): string | null;
    setComputerLabel(label?: string): void;

    /** Seconds the computer has been running (like Node `process.uptime()`). */
    clock(): number;

    /** In-game time of day, in the range [0, 24). */
    time(): number;
    /** In-game day count since world creation. */
    day(): number;
    /** In-game milliseconds since world creation. */
    epoch(): number;
}
