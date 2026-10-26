// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Run by the gametest bios (see ManagedComputers.TEST_BIOS) on every JS computer in the test world. Runs the test
// program for this computer's label, and reports the result through the global `test` API.
(function () {
    var system = require('system');
    var fs = require('fs');

    var label = system.getComputerLabel();
    if (label == null) return test.fail('Label a computer to use it.');

    var path = '/tests/' + label + '.js';
    // Not every computer in a test structure runs a test program: those without one just stay idle.
    if (!fs.existsSync(path)) return;

    try {
        require(path);
    } catch (e) {
        return test.fail(e != null && e.message !== undefined ? e.message : String(e));
    }

    print('Run ' + label);
    test.ok();
})();
