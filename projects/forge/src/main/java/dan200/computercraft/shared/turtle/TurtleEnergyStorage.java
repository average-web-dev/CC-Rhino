// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.turtle;

import dan200.computercraft.shared.turtle.core.TurtleAccessInternal;
import dan200.computercraft.shared.util.DirectionUtil;
import net.minecraft.core.Direction;
import net.neoforged.neoforge.energy.IEnergyStorage;
import org.jspecify.annotations.Nullable;

/**
 * Exposes a turtle's energy buffer as a Forge Energy {@link IEnergyStorage} on one face, so machines/cables can
 * charge it. Charging is gated by the turtle-relative per-side charge rate the script configures
 * ({@code turtle.setChargeRate}; {@code 0} disables that face). This is a sink only — discharging is performed
 * actively by the turtle each tick (see {@code TurtleBrain.pushEnergy}), since FE machines push rather than pull.
 */
public class TurtleEnergyStorage implements IEnergyStorage {
    private final TurtleAccessInternal turtle;
    private final @Nullable Direction side;

    public TurtleEnergyStorage(TurtleAccessInternal turtle, @Nullable Direction side) {
        this.turtle = turtle;
        this.side = side;
    }

    /** FE/t this face accepts. A {@code null} (unsided) query allows charging; a turtle without fuel accepts none. */
    private int chargeRate() {
        if (!turtle.isEnergyNeeded()) return 0;
        if (side == null) return Integer.MAX_VALUE;
        return turtle.getChargeRate(DirectionUtil.toLocal(turtle.getDirection(), side));
    }

    @Override
    public int receiveEnergy(int toReceive, boolean simulate) {
        var accepted = Math.min(Math.min(toReceive, chargeRate()), turtle.getEnergyCapacity() - turtle.getEnergyLevel());
        if (accepted <= 0) return 0;
        if (!simulate) turtle.addEnergy(accepted);
        return accepted;
    }

    @Override
    public int extractEnergy(int toExtract, boolean simulate) {
        return 0;
    }

    @Override
    public int getEnergyStored() {
        return turtle.getEnergyLevel();
    }

    @Override
    public int getMaxEnergyStored() {
        return turtle.getEnergyCapacity();
    }

    @Override
    public boolean canExtract() {
        return false;
    }

    @Override
    public boolean canReceive() {
        return chargeRate() > 0;
    }
}
