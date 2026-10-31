// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Ctrl+C while a turtle command is in flight terminates the foreground program (run in a parallel.waitFor* thread,
// as the shell does) with Error("Terminated").
import parallel from 'parallel';
import turtle from 'turtle';

let error: unknown = null;
try {
    parallel.waitForAny(function () {
        // Start an animation, so the next command stays queued for several ticks.
        test.eq(true, turtle.forward().success, 'First move');
        // Delivered once this thread has parked in the next forward(), and before that move completes.
        test.queueEvent('terminate');
        turtle.forward();
        test.fail('forward() returned instead of being terminated');
    });
} catch (e) {
    error = e;
}

test.assert(error instanceof Error, 'Terminate throws an Error (got ' + error + ')');
test.eq('Terminated', error.message);

// Terminating doesn't cancel the queued move (it still runs), and the turtle keeps working afterwards.
test.eq(true, turtle.back().success, 'Turtle still runs commands');

export {};
