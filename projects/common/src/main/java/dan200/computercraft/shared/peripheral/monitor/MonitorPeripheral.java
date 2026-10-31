// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.shared.peripheral.monitor;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.api.scripting.ScriptValues;
import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.core.apis.tty.TtyHandle;
import org.jspecify.annotations.Nullable;

/**
 * Monitors are a block which act as a terminal, displaying information on one side. This allows them to be read and
 * interacted with in-world without opening a GUI.
 * <p>
 * A monitor is a TTY ({@link #getTty}): programs draw on it by writing text and ANSI escape sequences to the TTY (e.g.
 * through a {@code Term}), or run on it when started with it as their TTY. The peripheral itself only holds the device
 * settings.
 * <p>
 * If the monitor is resized (by adding new blocks to the monitor, or by calling {@link setTextScale}), then a
 * [`monitor_resize`] event will be queued.
 * <p>
 * Like computers, monitors come in both normal (no colour) and advanced (colour) varieties. Advanced monitors be right
 * clicked, which will trigger a [`monitor_touch`] event.
 * <p>
 * ## Recipes
 * <div class="recipe-container">
 *     <mc-recipe recipe="computercraft:monitor_normal"></mc-recipe>
 *     <mc-recipe recipe="computercraft:monitor_advanced"></mc-recipe>
 * </div>
 *
 * @cc.module monitor
 * @cc.usage Write "Hello, world!" to an adjacent monitor:
 *
 * <pre>{@code
 * const peripheral = require("peripheral");
 * new Term(TTY.from(peripheral.call("top", "getTty"))).write("Hello, world!");
 * }</pre>
 * @cc.see monitor_resize Queued when a monitor is resized.
 * @cc.see monitor_touch Queued when an advanced monitor is clicked.
 */
public class MonitorPeripheral implements IPeripheral {
    private final MonitorBlockEntity monitor;

    public MonitorPeripheral(MonitorBlockEntity monitor) {
        this.monitor = monitor;
    }

    @Override
    public String getType() {
        return "monitor";
    }

    /**
     * Set the scale of this monitor. A larger scale will result in the monitor having a lower resolution, but display
     * text much larger.
     *
     * @param scaleArg The monitor's scale. This must be a multiple of 0.5 between 0.5 and 5.
     * @throws ScriptException If the scale is out of range.
     * @see #getTextScale()
     */
    @ScriptFunction
    public final void setTextScale(double scaleArg) throws ScriptException {
        var scale = (int) (ScriptValues.checkFinite(0, scaleArg) * 2.0);
        if (scale < 1 || scale > 10) throw new ScriptException("Expected number in range 0.5-5");
        getMonitor().setTextScale(scale);
    }

    /**
     * Get the monitor's current text scale.
     *
     * @return The monitor's current scale.
     * @throws ScriptException If the monitor cannot be found.
     * @cc.since 1.81.0
     */
    @ScriptFunction
    public final double getTextScale() throws ScriptException {
        return getMonitor().getTextScale() / 2.0;
    }

    /**
     * The TTY of this monitor: text and ANSI escape sequences written to its {@code stdout} appear on the monitor, and
     * touches arrive in its {@code stdin} as mouse input once a program asks for it ({@code ESC [ ? 1000 h}). A program
     * runs on the monitor when it is started with this TTY.
     *
     * @param computer The computer calling this method.
     * @return The monitor's TTY.
     * @throws ScriptException If the monitor cannot be found.
     */
    @ScriptFunction
    public final TtyHandle getTty(IComputerAccess computer) throws ScriptException {
        return new TtyHandle(computer::queueEvent, getMonitor().getTty(), false);
    }

    @Override
    public void attach(IComputerAccess computer) {
        monitor.addComputer(computer);
    }

    @Override
    public void detach(IComputerAccess computer) {
        monitor.removeComputer(computer);
    }

    @Override
    public boolean equals(@Nullable IPeripheral other) {
        return other instanceof MonitorPeripheral o && monitor == o.monitor;
    }

    private ServerMonitor getMonitor() throws ScriptException {
        var monitor = this.monitor.getCachedServerMonitor();
        if (monitor == null) throw new ScriptException("Monitor has been detached");
        return monitor;
    }

    @Nullable
    @Override
    public Object getTarget() {
        return monitor;
    }
}
