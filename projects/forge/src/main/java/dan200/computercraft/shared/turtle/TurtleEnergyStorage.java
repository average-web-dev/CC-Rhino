// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.turtle;

import dan200.computercraft.shared.config.Config;
import dan200.computercraft.shared.turtle.core.TurtleAccessInternal;
import dan200.computercraft.shared.util.DirectionUtil;
import net.minecraft.core.Direction;
import net.neoforged.neoforge.energy.IEnergyStorage;
import org.jspecify.annotations.Nullable;

/**
 * Exposes a turtle's energy buffer as a Forge Energy {@link IEnergyStorage} on one face. Both directions are gated
 * by the turtle-relative per-side rates the script configures ({@code turtle.setChargeRate}/{@code setDischargeRate};
 * {@code 0} disables that direction). Charging is passive (a machine pushes in); discharging additionally happens
 * actively each tick (see {@code TurtleBrain.pushEnergy}, since FE machines push rather than pull), but a discharge
 * rate also permits pulling (e.g. another turtle's {@code absorbEnergy}).
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
        var requested = side == null ? Integer.MAX_VALUE : turtle.getChargeRate(DirectionUtil.toLocal(turtle.getDirection(), side));
        return Math.min(requested, Config.turtleMaxChargeRate);
    }

    /** FE/t this face emits when pulled. A {@code null} (unsided) query, or a turtle without fuel, emits none. */
    private int dischargeRate() {
        if (!turtle.isEnergyNeeded() || side == null) return 0;
        return Math.min(turtle.getDischargeRate(DirectionUtil.toLocal(turtle.getDirection(), side)), Config.turtleMaxDischargeRate);
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
        var extracted = Math.min(Math.min(toExtract, dischargeRate()), turtle.getEnergyLevel());
        if (extracted <= 0) return 0;
        if (!simulate) turtle.consumeEnergy(extracted);
        return extracted;
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
        return dischargeRate() > 0;
    }

    @Override
    public boolean canReceive() {
        return chargeRate() > 0;
    }
}
