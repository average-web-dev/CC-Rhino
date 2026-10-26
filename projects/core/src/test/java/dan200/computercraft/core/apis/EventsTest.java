// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.Event;
import dan200.computercraft.api.scripting.Events;
import dan200.computercraft.core.apis.events.CoreEvents;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link Events} turns {@link Event} records into the {@code (name, args)} pair queued on the computer, and keeps the
 * registry of native event names.
 */
public class EventsTest {
    @Event("spread")
    public record Spread(int first, String... rest) {
    }

    @Test
    void components_become_arguments_in_order() {
        var event = new CoreEvents.TaskComplete(3, false, null);
        assertEquals("task_complete", Events.name(event));
        assertEquals(Arrays.asList(3L, false, null), Arrays.asList(Events.arguments(event)));
    }

    /** A holder class of event records, as {@link CoreEvents}. */
    public static final class Holder {
        private Holder() {
        }

        @Event("holder_event")
        public record HolderEvent() {
        }
    }

    @Test
    void registered_events_are_native() {
        assertFalse(Events.isNative("spread"));
        assertFalse(Events.isNative("holder_event"));
        Events.register(Spread.class, Holder.class);
        assertTrue(Events.isNative("spread"));
        assertTrue(Events.isNative("holder_event"));
        assertThrows(IllegalArgumentException.class, () -> Events.register(String.class));
    }

    @Test
    void a_varargs_component_is_spread() {
        assertEquals(List.of(1, "a", "b"), Arrays.asList(Events.arguments(new Spread(1, "a", "b"))));
        assertEquals(List.of(1), Arrays.asList(Events.arguments(new Spread(1))));
    }
}
