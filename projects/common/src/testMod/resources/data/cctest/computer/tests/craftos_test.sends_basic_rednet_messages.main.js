// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Requires the rednet library (average-web-dev/CC-Rhino#5); the corresponding gametest is disabled until it exists.
var rednet = require('rednet');

rednet.open('top');

var received;
do {
    rednet.send(1, 'Test msg'); // Keep sending, as other computer may not have started yet.
    received = rednet.receive(undefined, 1);
} while (received == null || received[0] !== 1);

test.eq('Test msg', received[1]);
