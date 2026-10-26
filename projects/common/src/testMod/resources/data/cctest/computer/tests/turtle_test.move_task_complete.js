// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// A turtle movement suspends the program until the standard task_complete event arrives, and returns a Result.
var events = require('events');
var turtle = require('turtle');

var completions = 0;
events.on('task_complete', function () { completions++; });

// setImmediate callbacks only run once the program yields, so this proves forward() suspended.
var ranWhileSuspended = false;
events.setImmediate(function () { ranWhileSuspended = true; });

var moved = turtle.forward();
test.assert(ranWhileSuspended, 'Other work ran while the move was in flight');
test.eq(true, moved.success, 'Moved forward');
test.assert(moved.reason == null, 'A successful move has no reason');

var blocked = turtle.forward();
test.eq(false, blocked.success, 'Blocked move fails');
test.eq('Movement obstructed', blocked.reason);

test.assert(completions >= 1, 'Moves completed through task_complete events');
