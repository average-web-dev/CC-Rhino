// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Other events are dispatched to listeners while a turtle command waits for a multi-tick move to finish animating.
var events = require('events');
var system = require('system');
var turtle = require('turtle');

var moving = false;
var timer = -1;
var seen = [];
events.on('timer', function (id) { if (moving && id === timer) seen.push('timer'); });
events.on('redstone', function () { if (moving) seen.push('redstone'); });

// The first move completes on the next tick, but starts an 8 tick animation. The next command only runs once that
// animation has finished.
test.eq(true, turtle.forward().success, 'First move');

// The gametest places a redstone block next to the turtle once it sees this marker.
test.ok('moving');
timer = system.startTimer(0.1);
moving = true;
var result = turtle.forward();
moving = false;

test.eq(true, result.success, 'Second move');
test.assert(seen.indexOf('timer') >= 0, 'Timer fired during the move (saw ' + JSON.stringify(seen) + ')');
test.assert(seen.indexOf('redstone') >= 0, 'Redstone changed during the move (saw ' + JSON.stringify(seen) + ')');
