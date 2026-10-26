// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis;

import dan200.computercraft.test.core.apis.BasicApiEnvironment;
import dan200.computercraft.test.core.computer.BasicEnvironment;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SystemAPITest {
    private double time;
    private int day;
    private final List<String> events = new ArrayList<>();

    private final BasicEnvironment environment = new BasicEnvironment() {
        @Override
        public double getTimeOfDay() {
            return time;
        }

        @Override
        public int getDay() {
            return day;
        }
    };

    private final SystemAPI api = new SystemAPI(new BasicApiEnvironment(environment) {
        @Override
        public void queueEvent(String event, @Nullable Object... args) {
            events.add(event + " " + args[0]);
        }
    });

    @Test
    void alarm_fires_on_the_tick_its_time_is_reached() throws Exception {
        time = 5.0;
        api.startup();
        var alarm = api.setAlarm(6.0);

        time = 5.5;
        api.update();
        assertEquals(List.of(), events, "alarm must not fire early");

        time = 6.0;
        api.update();
        assertEquals(List.of("alarm " + alarm), events, "alarm should fire on the tick the time is reached");
    }

    @Test
    void alarm_before_current_time_fires_the_next_day() throws Exception {
        time = 10.0;
        api.startup();
        var alarm = api.setAlarm(2.0);

        time = 23.0;
        api.update();
        assertEquals(List.of(), events, "alarm is for tomorrow");

        time = 2.0;
        day = 1;
        api.update();
        assertEquals(List.of("alarm " + alarm), events);
    }
}
