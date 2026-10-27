// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// A turtle command whose execute() throws surfaces as a catchable JS error, rather than hanging the program.
const turtle = require('turtle');

let error: unknown = null;
try {
    test.runFaultyTurtleCommand('Command exploded');
} catch (e) {
    error = e;
}

test.assert(error instanceof Error, 'Faulty command throws an Error (got ' + error + ')');
test.eq('Command exploded', error.message);

// The command queue keeps working afterwards.
test.eq(true, turtle.turnLeft().success, 'Turtle still runs commands');

export {};
