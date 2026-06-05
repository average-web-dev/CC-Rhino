// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `turtle` — robotic block-placing device. All functions block (world interaction).
// "Can-fail" actions return a `Result` object instead of a (bool, string) tuple.

/** The two upgrade sides of a turtle. */
type TurtleSide = "left" | "right";

/** Result of an inspection: present block details, or a reason none was found. */
interface InspectResult {
    ok: boolean;
    data?: Details;
    reason?: string;
}

interface TurtleModule {
    forward(): Result;
    back(): Result;
    up(): Result;
    down(): Result;
    turnLeft(): Result;
    turnRight(): Result;

    dig(side?: TurtleSide): Result;
    digUp(side?: TurtleSide): Result;
    digDown(side?: TurtleSide): Result;

    place(text?: string): Result;
    placeUp(text?: string): Result;
    placeDown(text?: string): Result;

    drop(count?: number): Result;
    dropUp(count?: number): Result;
    dropDown(count?: number): Result;

    suck(count?: number): Result;
    suckUp(count?: number): Result;
    suckDown(count?: number): Result;

    attack(side?: TurtleSide): Result;
    attackUp(side?: TurtleSide): Result;
    attackDown(side?: TurtleSide): Result;

    detect(): boolean;
    detectUp(): boolean;
    detectDown(): boolean;

    compare(): boolean;
    compareUp(): boolean;
    compareDown(): boolean;

    inspect(): InspectResult;
    inspectUp(): InspectResult;
    inspectDown(): InspectResult;

    /** Select the active slot (1–16). Throws if out of range. */
    select(slot: number): void;
    getSelectedSlot(): number;

    getItemCount(slot?: number): number;
    getItemSpace(slot?: number): number;
    getItemDetail(slot?: number, detailed?: boolean): Details | null;

    compareTo(slot: number): boolean;
    transferTo(slot: number, count?: number): Result;

    refuel(count?: number): Result;
    getFuelLevel(): number | "unlimited";
    getFuelLimit(): number | "unlimited";

    equipLeft(): Result;
    equipRight(): Result;
    getEquippedLeft(): Details | null;
    getEquippedRight(): Details | null;
}
