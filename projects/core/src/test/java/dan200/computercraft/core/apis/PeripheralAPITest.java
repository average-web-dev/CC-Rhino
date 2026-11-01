// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.computer.ComputerBootstrap;
import dan200.computercraft.core.computer.ComputerSide;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/**
 * The device registry of {@code internal/peripheral} (#61): devices on the sides and devices attached by another
 * peripheral ({@link IComputerAccess#attachDevice}, as a wired modem does) are the same, by id.
 */
public class PeripheralAPITest {
    @Test
    void devicesById() {
        ComputerBootstrap.run(
            """
                var peripheral = require('internal/peripheral');
                var events = require('events');
                var system = require('system');
                function same(a, b, message) { assert(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a)); }

                // Sides get <type>_<side> outside a world; the hub's device has the id the hub gave it.
                same(peripheral.getNames(), ['hub_top', 'thing_7', 'thing_left'], 'every device, sorted');
                same(peripheral.getType('thing_7'), ['thing'], 'types by id');
                assert(peripheral.hasType('thing_7', 'thing') === true, 'hasType');
                assert(peripheral.getType('thing_8') === null, 'no such device');
                assert(peripheral.getDeviceOn('top') === 'hub_top', 'the device on a side');
                assert(peripheral.getDeviceOn('bottom') === null, 'nothing on the bottom');
                assert(peripheral.isPresent('left') === true, 'a side still finds its device');
                assert(peripheral.call('thing_7', 'which') === 'hub', 'calls by id');
                assert(peripheral.call('thing_7', 'name') === 'thing_7', 'the attachment name is the id');
                assert(peripheral.call('left', 'name') === 'thing_left', 'also for a device on a side');

                // The same device reached twice is one device: the first attachment stays in use.
                var seen = [];
                events.on('peripheral', function (id) { seen.push('+' + id); });
                events.on('peripheral_detach', function (id) { seen.push('-' + id); });
                peripheral.call('top', 'attachCopy');
                same(peripheral.getNames(), ['hub_top', 'thing_7', 'thing_left'], 'no second entry');
                assert(peripheral.call('thing_left', 'which') === 'left', 'the first attachment is used');
                peripheral.call('top', 'detachCopy');
                assert(peripheral.isPresent('thing_left'), 'still there');

                peripheral.call('top', 'detach7');
                assert(peripheral.isPresent('thing_7') === false, 'detached');
                system.sleep(1);
                same(seen, ['-thing_7'], 'events by id, none for the copy');

                var err = null;
                try { peripheral.call('thing_7', 'which'); } catch (e) { err = String(e.message); }
                assert(err === 'No such device: thing_7', 'error: ' + err);""",
            x -> {
                x.getEnvironment().setPeripheral(ComputerSide.TOP, new Hub());
                x.getEnvironment().setPeripheral(ComputerSide.LEFT, new Thing("left"));
            },
            50);
    }

    public static class Thing implements IPeripheral {
        private final String which;

        public Thing(String which) {
            this.which = which;
        }

        @ScriptFunction
        public final String which() {
            return which;
        }

        @ScriptFunction
        public final String name(IComputerAccess computer) {
            return computer.getAttachmentName();
        }

        @Override
        public String getType() {
            return "thing";
        }

        @Override
        public boolean equals(@Nullable IPeripheral other) {
            return this == other;
        }
    }

    /** Attaches a device of its own, as a wired modem attaches its network's peripherals. */
    public static class Hub implements IPeripheral {
        @Override
        public void attach(IComputerAccess computer) {
            computer.attachDevice("thing_7", new Thing("hub"));
        }

        @ScriptFunction
        public final void attachCopy(IComputerAccess computer) {
            computer.attachDevice("thing_left", new Thing("copy"));
        }

        @ScriptFunction
        public final void detachCopy(IComputerAccess computer) {
            computer.detachDevice("thing_left");
        }

        @ScriptFunction
        public final void detach7(IComputerAccess computer) {
            computer.detachDevice("thing_7");
        }

        @ScriptFunction
        public final void attach9(IComputerAccess computer) {
            computer.attachDevice("thing_9", new Thing("nine"));
        }

        @Override
        public String getType() {
            return "hub";
        }

        @Override
        public boolean equals(@Nullable IPeripheral other) {
            return this == other;
        }
    }
}
