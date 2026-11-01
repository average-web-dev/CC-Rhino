// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.filesystem.WritableMount;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.core.filesystem.WritableFileMount;
import dan200.computercraft.core.metrics.MetricsObserver;
import org.jspecify.annotations.Nullable;

public interface ComputerEnvironment {
    /**
     * Get the current in-game day.
     *
     * @return The current day.
     */
    int getDay();

    /**
     * Get the current in-game time of day.
     *
     * @return The current time.
     */
    double getTimeOfDay();

    /**
     * Get the {@link MetricsObserver} for this computer. This should be constant for the duration of this
     * {@link ComputerEnvironment}.
     *
     * @return This computer's {@link MetricsObserver}.
     */
    MetricsObserver getMetrics();

    /**
     * Construct the mount for this computer's user-writable data.
     *
     * @return The constructed mount or {@code null} if the mount could not be created.
     * @see WritableFileMount
     */
    @Nullable
    WritableMount createRootMount();

    /**
     * The id of a device attached to one of this computer's sides: a name for the device that is the same on every
     * computer and wherever it is attached (see {@code DeviceIds} in the mod). Devices reached through a wired network
     * are attached with their id ({@link dan200.computercraft.api.peripheral.IComputerAccess#attachDevice}).
     * <p>
     * The default, for computers outside a world, is {@code <type>_<side>}.
     *
     * @param side       The side the device is attached to.
     * @param peripheral The device.
     * @return The device's id.
     */
    default String deviceId(ComputerSide side, IPeripheral peripheral) {
        return peripheral.getType() + "_" + side.getName();
    }
}
