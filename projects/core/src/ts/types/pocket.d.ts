// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `pocket` — manage the current pocket computer's upgrade. Only present on pocket computers.

interface PocketModule {
    /** Equip an upgrade found in the player's inventory. */
    equipBack(): Result;
    /** Remove the current upgrade. */
    unequipBack(): Result;
}
