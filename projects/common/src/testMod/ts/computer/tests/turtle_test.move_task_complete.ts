// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// A turtle movement suspends the program until the standard task_complete event arrives, and returns a Result.
const events = require('events');
const turtle = require('turtle');

let completions = 0;
events.on('task_complete', function () { completions++; });

// setImmediate callbacks only run once the program yields, so this proves forward() suspended.
let ranWhileSuspended = false;
events.setImmediate(function () { ranWhileSuspended = true; });

const moved = turtle.forward();
test.assert(ranWhileSuspended, 'Other work ran while the move was in flight');
test.eq(true, moved.success, 'Moved forward');
// Read the raw property: the Result type has no `reason` on success, which is what this checks.
test.assert((moved as { reason?: string | null }).reason == null, 'A successful move has no reason');

const blocked = turtle.forward();
test.eq(false, blocked.success, 'Blocked move fails');
test.eq('Movement obstructed', (blocked as { reason?: string }).reason);

test.assert(completions >= 1, 'Moves completed through task_complete events');

export {};
