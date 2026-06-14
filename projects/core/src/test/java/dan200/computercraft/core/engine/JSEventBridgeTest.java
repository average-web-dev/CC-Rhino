// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Phase 8.2 — verifies the {@link JSEventEmitter} bridge: JS registers listeners via {@code os.on/once/off}
 * (the emitter is attached to the {@code os} native module) and Java-side {@link JSMachine#handleEvent} dispatches
 * events to them with converted arguments.
 */
class JSEventBridgeTest {
    /** {@code os.on("foo", cb)} then firing {@code "foo"} from Java invokes the callback with the event argument. */
    @Test
    void on_listener_receives_event_argument() throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("events", java.util.Map.of())
            .api(rec, rec.methods())
            .bios("""
                var events = require('events');
                var probe = require('probe');
                events.on("foo", function (v) { probe.record(v); });
                """)
            .build();
        try {
            assertFalse(machine.handleEvent(null, null).isError(), "boot should succeed");
            assertEquals(List.of(), rec.values, "listener must not fire before the event");

            var result = machine.handleEvent("foo", new Object[]{ "bar" });
            assertFalse(result.isError(), "dispatch should succeed: " + result.getMessage());
            assertEquals(List.of("bar"), rec.values, "callback should receive the event argument");
        } finally {
            machine.close();
        }
    }

    /** A {@code once} listener fires for the first matching event only. */
    @Test
    void once_listener_fires_only_once() throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("events", java.util.Map.of())
            .api(rec, rec.methods())
            .bios("""
                var events = require('events');
                var probe = require('probe');
                events.once("tick", function (v) { probe.record(v); });
                """)
            .build();
        try {
            machine.handleEvent(null, null);
            machine.handleEvent("tick", new Object[]{ "a" });
            machine.handleEvent("tick", new Object[]{ "b" });
            assertEquals(List.of("a"), rec.values, "once listener should fire exactly once");
        } finally {
            machine.close();
        }
    }

    /** {@code os.off} removes a previously registered listener. */
    @Test
    void off_removes_listener() throws Exception {
        var rec = new JSMachineBuilder.Recorder();
        var machine = new JSMachineBuilder()
            .api("os", java.util.Map.of())
            .api(rec, rec.methods())
            .bios("""
                var events = require('events');
                var probe = require('probe');
                function cb(v) { probe.record(v); }
                events.on("ping", cb);
                events.off("ping", cb);
                """)
            .build();
        try {
            machine.handleEvent(null, null);
            machine.handleEvent("ping", new Object[]{ "x" });
            assertEquals(List.of(), rec.values, "removed listener must not fire");
        } finally {
            machine.close();
        }
    }
}
