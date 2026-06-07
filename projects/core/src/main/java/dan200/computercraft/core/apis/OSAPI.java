// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.util.StringUtil;
import it.unimi.dsi.fastutil.ints.Int2ObjectMap;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;
import org.jspecify.annotations.Nullable;

import java.util.*;

import static dan200.computercraft.api.scripting.ScriptValues.checkFinite;

/**
 * The {@link OSAPI} API allows interacting with the current computer.
 *
 * @cc.module os
 */
public class OSAPI implements IComputerAPI {
    private final IAPIEnvironment apiEnvironment;

    private final Int2ObjectMap<Alarm> alarms = new Int2ObjectOpenHashMap<>();
    private int clock;
    private double time;
    private int day;

    private int nextAlarmToken = 0;

    private record Alarm(double time, int day) implements Comparable<Alarm> {
        @Override
        public int compareTo(Alarm o) {
            var t = day * 24.0 + time;
            var ot = day * 24.0 + time;
            return Double.compare(t, ot);
        }
    }

    public OSAPI(IAPIEnvironment environment) {
        apiEnvironment = environment;
    }

    @Override
    public String[] getNames() {
        return new String[]{ "os" };
    }

    @Override
    public void startup() {
        time = apiEnvironment.getComputerEnvironment().getTimeOfDay();
        day = apiEnvironment.getComputerEnvironment().getDay();
        clock = 0;

        synchronized (alarms) {
            alarms.clear();
        }
    }

    @Override
    public void update() {
        clock++;

        // Wait for all of our alarms
        synchronized (alarms) {
            var previousTime = time;
            var previousDay = day;
            var time = apiEnvironment.getComputerEnvironment().getTimeOfDay();
            var day = apiEnvironment.getComputerEnvironment().getDay();

            if (time > previousTime || day > previousDay) {
                var now = this.day * 24.0 + this.time;
                Iterator<Int2ObjectMap.Entry<Alarm>> it = alarms.int2ObjectEntrySet().iterator();
                while (it.hasNext()) {
                    var entry = it.next();
                    var alarm = entry.getValue();
                    var t = alarm.day * 24.0 + alarm.time;
                    if (now >= t) {
                        apiEnvironment.queueEvent("alarm", entry.getIntKey());
                        it.remove();
                    }
                }
            }

            this.time = time;
            this.day = day;
        }
    }

    @Override
    public void shutdown() {
        synchronized (alarms) {
            alarms.clear();
        }
    }

    private static float getTimeForCalendar(Calendar c) {
        float time = c.get(Calendar.HOUR_OF_DAY);
        time += c.get(Calendar.MINUTE) / 60.0f;
        time += c.get(Calendar.SECOND) / (60.0f * 60.0f);
        return time;
    }

    private static int getDayForCalendar(Calendar calendar) {
        var g = calendar instanceof GregorianCalendar c ? c : new GregorianCalendar();
        var year = calendar.get(Calendar.YEAR);
        var day = 0;
        for (var y = 1970; y < year; y++) {
            day += g.isLeapYear(y) ? 366 : 365;
        }
        day += calendar.get(Calendar.DAY_OF_YEAR);
        return day;
    }

    private static long getEpochForCalendar(Calendar c) {
        return c.getTimeInMillis();
    }

    /**
     * Adds an event to the event queue. This event can later be pulled with
     * os.pullEvent.
     *
     * @param name The name of the event to queue.
     * @param args The parameters of the event.
     * @cc.tparam string name The name of the event to queue.
     * @cc.param ... The parameters of the event. These can be any primitive type (boolean, number, string) as well as
     *               tables. Other types (like functions), as well as metatables, will not be preserved.
     * @cc.see os.pullEvent To pull the event queued
     */
    @ScriptFunction
    public final void queueEvent(String name, IArguments args) throws ScriptException {
        apiEnvironment.queueEvent(name, args.drop(1).getAll());
    }

    /**
     * Starts a timer that will run for the specified number of seconds. Once
     * the timer fires, a [`timer`] event will be added to the queue with the ID
     * returned from this function as the first parameter.
     * <p>
     * As with [sleep][`os.sleep`], the time will automatically be rounded up to
     * the nearest multiple of 0.05 seconds, as it waits for a fixed amount of
     * world ticks.
     *
     * @param time The number of seconds until the timer fires.
     * @return The ID of the new timer. This can be used to filter the [`timer`]
     * event, or {@linkplain #cancelTimer cancel the timer}.
     * @throws ScriptException If the time is below zero.
     * @see #cancelTimer To cancel a timer.
     */
    @ScriptFunction
    public final int startTimer(double time) throws ScriptException {
        return apiEnvironment.startTimer(Math.round(checkFinite(0, time) / 0.05));
    }

    /**
     * Cancels a timer previously started with {@link #startTimer(double)}. This
     * will stop the timer from firing.
     *
     * @param token The ID of the timer to cancel.
     * @cc.since 1.6
     * @see #startTimer To start a timer.
     */
    @ScriptFunction
    public final void cancelTimer(int token) {
        apiEnvironment.cancelTimer(token);
    }

    /**
     * Sets an alarm that will fire at the specified in-game time.
     * When it fires, an {@code alarm} event will be added to the event queue with the
     * ID returned from this function as the first parameter.
     *
     * @param time The time at which to fire the alarm, in the range [0.0, 24.0).
     * @return The ID of the new alarm. This can be used to filter the
     * {@code alarm} event, or {@link #cancelAlarm cancel the alarm}.
     * @throws ScriptException If the time is out of range.
     * @cc.since 1.2
     * @see #cancelAlarm To cancel an alarm.
     */
    @ScriptFunction
    public final int setAlarm(double time) throws ScriptException {
        checkFinite(0, time);
        if (time < 0.0 || time >= 24.0) throw new ScriptException("Number out of range");
        synchronized (alarms) {
            var day = time > this.time ? this.day : this.day + 1;
            alarms.put(nextAlarmToken, new Alarm(time, day));
            return nextAlarmToken++;
        }
    }

    /**
     * Cancels an alarm previously started with setAlarm. This will stop the
     * alarm from firing.
     *
     * @param token The ID of the alarm to cancel.
     * @cc.since 1.6
     * @see #setAlarm To set an alarm.
     */
    @ScriptFunction
    public final void cancelAlarm(int token) {
        synchronized (alarms) {
            alarms.remove(token);
        }
    }

    /**
     * Shuts down the computer immediately.
     */
    @ScriptFunction("shutdown")
    public final void doShutdown() {
        apiEnvironment.shutdown();
    }

    /**
     * Reboots the computer immediately.
     */
    @ScriptFunction("reboot")
    public final void doReboot() {
        apiEnvironment.reboot();
    }

    /**
     * Returns the ID of the computer.
     *
     * @return The ID of the computer.
     */
    @ScriptFunction({ "getComputerID", "computerID" })
    public final int getComputerID() {
        return apiEnvironment.getComputerID();
    }

    /**
     * Returns the label of the computer, or {@code nil} if none is set.
     *
     * @return The label of the computer.
     * @cc.treturn string|nil The label of the computer.
     * @cc.since 1.3
     */
    @ScriptFunction({ "getComputerLabel", "computerLabel" })
    public final Object @Nullable [] getComputerLabel() {
        var label = apiEnvironment.getLabel();
        return label == null ? null : new Object[]{ label };
    }

    /**
     * Set the label of this computer.
     *
     * @param label The new label. May be {@code nil} in order to clear it.
     * @cc.since 1.3
     */
    @ScriptFunction
    public final void setComputerLabel(Optional<String> label) {
        apiEnvironment.setLabel(label.map(StringUtil::normaliseLabel).orElse(null));
    }

    /**
     * Returns the number of seconds that the computer has been running.
     *
     * @return The computer's uptime.
     * @cc.since 1.2
     */
    @ScriptFunction
    public final double clock() {
        return clock * 0.05;
    }

    /**
     * Returns the current time depending on the string passed in. This will
     * always be in the range [0.0, 24.0).
     * <p>
     * * If called with {@code ingame}, the current world time will be returned.
     * This is the default if nothing is passed.
     * * If called with {@code utc}, returns the hour of the day in UTC time.
     * * If called with {@code local}, returns the hour of the day in the
     * timezone the server is located in.
     *
     * @param locale The locale of the time. Defaults to {@code ingame} if not specified.
     * @return The hour of the selected locale.
     * @throws ScriptException If an invalid locale is passed.
     * @cc.tparam [opt] string locale The locale of the time. Defaults to {@code ingame} if not specified.
     * @cc.see textutils.formatTime To convert times into a user-readable string.
     * @cc.usage Print the current in-game time.
     * <pre>{@code
     * textutils.formatTime(os.time())
     * }</pre>
     * @cc.since 1.2
     * @cc.changed 1.80pr1 Add support for getting the local and UTC time.
     * @cc.changed 1.82.0 Arguments are now case insensitive.
     */
    @ScriptFunction
    public final Object time(Optional<String> locale) throws ScriptException {
        return switch (locale.orElse("ingame").toLowerCase(Locale.ROOT)) {
            case "utc" -> getTimeForCalendar(Calendar.getInstance(TimeZone.getTimeZone("UTC")));
            case "local" -> getTimeForCalendar(Calendar.getInstance());
            case "ingame" -> time;
            default -> throw new ScriptException("Unsupported operation");
        };
    }

    /**
     * Returns the day depending on the locale specified.
     * <p>
     * * If called with {@code ingame}, returns the number of days since the
     * world was created. This is the default.
     * * If called with {@code utc}, returns the number of days since 1 January
     * 1970 in the UTC timezone.
     * * If called with {@code local}, returns the number of days since 1
     * January 1970 in the server's local timezone.
     *
     * @param locale The locale to get the day for. Defaults to {@code ingame} if not set.
     * @return The day depending on the selected locale.
     * @throws ScriptException If an invalid locale is passed.
     * @cc.since 1.48
     * @cc.changed 1.82.0 Arguments are now case insensitive.
     */
    @ScriptFunction
    public final int day(Optional<String> locale) throws ScriptException {
        return switch (locale.orElse("ingame").toLowerCase(Locale.ROOT)) {
            case "utc" -> getDayForCalendar(Calendar.getInstance(TimeZone.getTimeZone("UTC")));
            case "local" -> getDayForCalendar(Calendar.getInstance());
            case "ingame" -> day;
            default -> throw new ScriptException("Unsupported operation");
        };
    }

    /**
     * Returns the number of milliseconds since an epoch depending on the locale.
     * <p>
     * * If called with {@code ingame}, returns the number of *in-game* milliseconds since the
     * world was created. This is the default.
     * * If called with {@code utc}, returns the number of milliseconds since 1
     * January 1970 in the UTC timezone.
     * * If called with {@code local}, returns the number of milliseconds since 1
     * January 1970 in the server's local timezone.
     * <p>
     * > [!INFO]
     * > The {@code ingame} time zone assumes that one Minecraft day consists of 86,400,000
     * > milliseconds. Since one in-game day is much faster than a real day (20 minutes), this
     * > will change quicker than real time - one real second is equal to 72000 in-game
     * > milliseconds. If you wish to convert this value to real time, divide by 72000; to
     * > convert to ticks (where a day is 24000 ticks), divide by 3600.
     *
     * @param locale The locale to get the milliseconds for. Defaults to {@code ingame} if not set.
     * @return The milliseconds since the epoch depending on the selected locale.
     * @throws ScriptException If an invalid locale is passed.
     * @cc.since 1.80pr1
     */
    @ScriptFunction
    public final long epoch(Optional<String> locale) throws ScriptException {
        return switch (locale.orElse("ingame").toLowerCase(Locale.ROOT)) {
            case "utc" -> getEpochForCalendar(Calendar.getInstance(TimeZone.getTimeZone("UTC"))); // Get utc epoch
            case "local" -> getEpochForCalendar(Calendar.getInstance());  // Get local epoch
            case "ingame" -> day * 86400000L + (long) (time * 3600000.0); // Get in-game epoch
            default -> throw new ScriptException("Unsupported operation");
        };
    }

    /**
     * Pauses execution for the given number of game ticks (1 tick = 0.05 s).
     * Other events continue to be processed while sleeping.
     *
     * @param ticks Number of ticks to wait. Clamped to a minimum of 1.
     * @cc.tparam int ticks Number of game ticks to sleep.
     * @cc.since CC:Rhino 1.0
     * @cc.usage Sleep for one second (20 ticks).
     * <pre>{@code
     * os.sleep(20);
     * }</pre>
     */
    @ScriptFunction("sleep")
    public MethodResult doSleep(int ticks) {
        var timerId = apiEnvironment.startTimer(Math.max(1, ticks));
        return MethodResult.awaitTimer(timerId);
    }

    @ScriptFunction("yield")
    public MethodResult doYield() {
        apiEnvironment.queueEvent("cc:yield", new Object[0]);
        return MethodResult.awaitYield();
    }

}
