// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `redstone` (aka `rs`) — get/set redstone signals on the six adjacent sides.

interface RedstoneModule {
    getSides(): Side[];

    setOutput(side: Side, on: boolean): void;
    getOutput(side: Side): boolean;
    getInput(side: Side): boolean;

    setAnalogOutput(side: Side, value: number): void;
    getAnalogOutput(side: Side): number;
    getAnalogInput(side: Side): number;

    setBundledOutput(side: Side, mask: number): void;
    getBundledOutput(side: Side): number;
    getBundledInput(side: Side): number;
    testBundledInput(side: Side, mask: number): boolean;
}
