// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// turtle/promises: commands return promises settled through task_complete; async.unwrap and async.run bridge the
// blocking and the promise style; the blocking form throws a clear error inside async code, without running.
const async = require('async');
const turtle = require('turtle');
const turtleP = require('turtle/promises');

// The command starts without blocking the program.
let running = true;
let settledWhileRunning: boolean | null = null;
const pending = turtleP.forward();
pending.then(function () { settledWhileRunning = running; });
running = false;
test.assert(pending instanceof Promise, 'forward() returns a promise');
test.eq(true, async.unwrap(pending).success, 'Moved forward');
test.eq<boolean | null>(false, settledWhileRunning, 'The program kept running while the move was in flight');

// Several commands at once: they are queued, and Promise.all waits for all of them.
const turns = async.unwrap(Promise.all([turtleP.turnLeft(), turtleP.turnRight()]));
test.eq(true, turns[0].success && turns[1].success, 'Turned left and right');

// A plain generator function driven by async.run (yield = await), rather than a TypeScript `async` function.
const result = async.unwrap(async.run(function* () {
    let error: string | null = null;
    try {
        turtle.forward();
    } catch (e) {
        error = (e as Error).message;
    }
    let blocked: Result = yield turtleP.forward();
    return { error: error, blocked: blocked };
}));
test.eq("turtle.forward blocks and cannot be used inside async code — use require('turtle/promises') instead", result.error);
test.eq(false, result.blocked.success, 'Blocked move fails');
test.eq('Movement obstructed', (result.blocked as { reason?: string }).reason);

export {};
