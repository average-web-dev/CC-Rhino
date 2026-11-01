// SPDX-FileCopyrightText: 2018 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.peripheral.modem.wired;

import dan200.computercraft.api.ComputerCraftTags;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.core.util.PeripheralHelpers;
import dan200.computercraft.shared.computer.core.DeviceIds;
import dan200.computercraft.shared.computer.core.ServerContext;
import dan200.computercraft.shared.platform.ComponentAccess;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.Level;
import org.jspecify.annotations.Nullable;

import java.util.Map;

import static dan200.computercraft.core.util.Nullability.assertNonNull;

/**
 * Represents a local peripheral exposed on the wired network.
 * <p>
 * This is responsible for getting the peripheral in world, naming it with its device id ({@link DeviceIds}, the same as
 * when it is attached to a computer directly) and determining whether it has changed.
 */
public final class WiredModemLocalPeripheral {
    private @Nullable String name;

    private @Nullable IPeripheral peripheral;
    private final ComponentAccess<IPeripheral> peripherals;

    public WiredModemLocalPeripheral(ComponentAccess<IPeripheral> peripherals) {
        this.peripherals = peripherals;
    }

    /**
     * Attach a new peripheral from the world.
     *
     * @param world     The world to search in
     * @param origin    The position to search from
     * @param direction The direction so search in
     * @return Whether the peripheral changed.
     */
    public boolean attach(Level world, BlockPos origin, Direction direction) {
        var oldPeripheral = peripheral;
        var peripheral = this.peripheral = getPeripheralFrom(world, origin, direction);

        if (peripheral == null) {
            name = null;
            return oldPeripheral != null;
        } else {
            var key = DeviceIds.blockKey(peripheral.getTarget());
            if (key == null) key = DeviceIds.blockKey(world, origin.relative(direction));
            name = ServerContext.get(assertNonNull(world.getServer())).deviceIds().idOf(key, peripheral.getType());
            return !PeripheralHelpers.equals(oldPeripheral, peripheral);
        }
    }

    /**
     * Detach the current peripheral.
     *
     * @return Whether the peripheral changed
     */
    public boolean detach() {
        if (peripheral == null) return false;
        peripheral = null;
        name = null;
        return true;
    }

    @Nullable
    public String getConnectedName() {
        return peripheral != null ? name : null;
    }

    public boolean hasPeripheral() {
        return peripheral != null;
    }

    public void extendMap(Map<String, IPeripheral> peripherals) {
        if (peripheral != null && name != null) peripherals.put(name, peripheral);
    }

    public Map<String, IPeripheral> toMap() {
        return peripheral == null || name == null ? Map.of() : Map.of(name, peripheral);
    }

    @Nullable
    private IPeripheral getPeripheralFrom(Level world, BlockPos pos, Direction direction) {
        var offset = pos.relative(direction);

        if (world.getBlockState(offset).is(ComputerCraftTags.Blocks.PERIPHERAL_HUB_IGNORE)) return null;

        var peripheral = peripherals.get(direction);
        return peripheral instanceof WiredModemPeripheral ? null : peripheral;
    }
}
