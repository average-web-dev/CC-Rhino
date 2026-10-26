// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Requires the rednet library (average-web-dev/CC-Rhino#5); the corresponding gametest is disabled until it exists.
// Both computers in this test have ID 0. The Lua version overrode os.getComputerID to pretend to be computer 1, so
// the rednet port will need an equivalent way to give the echo computer that ID.
var rednet = require('rednet');

rednet.open('top');
while (true) {
    var received = rednet.receive();
    rednet.send(received[0], received[1], received[2]);
}
