// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Bundled cables in the redstone module: channels as arrays of dyes (#53). Run by StdioLibraryTest.

import * as prelude from './prelude';
import redstone from 'redstone';
import { Dye } from 'color';

const eq = prelude.eq, throws = prelude.throws;

/** The channels that are on in a states object, as "a,b,c", for compact checks. */
function on(states: Record<Dye, boolean>): string {
    return Object.keys(states).filter((channel) => states[Number(channel) as Dye]).join();
}

// The dyes: Minecraft's ids, white 0 … black 15.
eq(Dye.WHITE, 0);
eq(Dye.RED, 14);
eq(Dye.BLACK, 15);
eq(Dye.GREY, Dye.GRAY, 'British spellings');
eq(new Set(Object.values(Dye)).size, 16, 'one id per dye');
eq(Object.isFrozen(Dye), true);

// Reading: every channel, keyed by dye.
const initial = redstone.getBundledOutput('top');
eq(Object.keys(initial).length, 16);
eq(initial[Dye.RED], false);
eq(on(initial), '', 'nothing on');

// Writing: the channels named change, the others stay.
redstone.setBundledOutput('top', { [Dye.RED]: true, [Dye.WHITE]: true });
eq(on(redstone.getBundledOutput('top')), '0,14');
eq(redstone.getBundledOutput('top')[Dye.RED], true);
redstone.setBundledOutput('top', { [Dye.BLUE]: true, [Dye.WHITE]: false });
eq(on(redstone.getBundledOutput('top')), '11,14', 'on and off in one call, red stays');
redstone.setBundledOutput('top', {});
eq(on(redstone.getBundledOutput('top')), '11,14', 'nothing named: no change');
redstone.setBundledOutput('back', redstone.getBundledOutput('top'));
eq(on(redstone.getBundledOutput('back')), '11,14', 'what get returns, set takes');
eq(on(redstone.getBundledOutput('front')), '', 'per side');

// All channels at once.
redstone.setAllBundledOutput('top', true);
eq(on(redstone.getBundledOutput('top')).split(',').length, 16);
redstone.setAllBundledOutput('top', false);
redstone.setAllBundledOutput('back', false);
eq(on(redstone.getBundledOutput('top')), '');

// Input: nothing is connected.
eq(on(redstone.getBundledInput('top')), '');
eq(redstone.getBundledInput('top')[Dye.WHITE], false);

// Keys are dyes (0–15), values booleans, and the states an object.
// @ts-expect-error: not a Dye.
throws(() => redstone.setBundledOutput('top', { 16: true }));
throws(() => redstone.setBundledOutput('top', { red: true } as any));
throws(() => redstone.setBundledOutput('top', { [Dye.RED]: 1 } as any));
throws(() => redstone.setBundledOutput('top', [true, false] as any), undefined, 'an array is not an object of states');
eq(on(redstone.getBundledOutput('top')), '', 'nothing changed by the failed calls');
