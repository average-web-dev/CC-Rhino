// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The rednet library does not exist yet (average-web-dev/CC-Rhino#5): this is the surface the (disabled) rednet
// gametest programs expect, modelled on CC's rednet API. Remove it once the ROM declares the real module.

interface RednetModule {
    /** Open the modem on `side` for rednet. */
    open(side: string): void;
    /** Send `message` to computer `recipient`, optionally under `protocol`. */
    send(recipient: number, message: unknown, protocol?: string): boolean;
    /**
     * Wait for a message (optionally only one sent under `protocol`, and for at most `timeout` seconds). Returns
     * `[sender, message, protocol]`, or `null` on a timeout.
     */
    receive(protocol?: string, timeout?: number): [sender: number, message: unknown, protocol: string | undefined] | null;
}

declare function require(id: "rednet"): RednetModule;
declare module "rednet" { const rednet: RednetModule; export = rednet; }
