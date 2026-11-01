// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// about — the version of CC: Rhino and Minecraft, and where the project lives.

import system from 'system';
import util from 'util';

export function main(): void {
    console.log(util.styleText('yellow', system.getHost()));
    console.log('A JavaScript runtime for ComputerCraft, based on CC: Tweaked and Mozilla Rhino.');
    console.log('https://github.com/average-web-dev/CC-Rhino');
}
