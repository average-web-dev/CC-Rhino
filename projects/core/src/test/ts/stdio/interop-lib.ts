// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// A module with a default export, imported by interop.ts (mounted next to it as /interop-lib.js).

export default function greet(name: string): string {
    return 'hi ' + name;
}

export const answer = 42;

export let counter = 0;

export function increment(): void {
    counter++;
}
