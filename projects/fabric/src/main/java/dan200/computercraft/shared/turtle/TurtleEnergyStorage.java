// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.turtle;

import dan200.computercraft.shared.config.Config;
import dan200.computercraft.shared.turtle.core.TurtleAccessInternal;
import dan200.computercraft.shared.util.DirectionUtil;
import net.fabricmc.fabric.api.transfer.v1.transaction.TransactionContext;
import net.fabricmc.fabric.api.transfer.v1.transaction.base.SnapshotParticipant;
import net.minecraft.core.Direction;
import org.jspecify.annotations.Nullable;
import team.reborn.energy.api.EnergyStorage;

/**
 * Exposes a turtle's energy buffer as a Tech Reborn {@link EnergyStorage} on one face — the Fabric counterpart
 * of the NeoForge capability — so machines/cables can charge it. Charging is gated by the script-configured
 * per-side charge rate; this is a sink only (discharging is performed actively by {@code TurtleBrain.pushEnergy}).
 *
 * <p>Extends {@link SnapshotParticipant} so an aborted transaction rolls the turtle's energy back.
 */
public class TurtleEnergyStorage extends SnapshotParticipant<Integer> implements EnergyStorage {
    private final TurtleAccessInternal turtle;
    private final @Nullable Direction side;

    public TurtleEnergyStorage(TurtleAccessInternal turtle, @Nullable Direction side) {
        this.turtle = turtle;
        this.side = side;
    }

    /** FE/t this face accepts, capped by the server max. A {@code null} (unsided) query allows charging. */
    private int chargeRate() {
        if (!turtle.isEnergyNeeded()) return 0;
        var requested = side == null ? Integer.MAX_VALUE : turtle.getChargeRate(DirectionUtil.toLocal(turtle.getDirection(), side));
        return Math.min(requested, Config.turtleMaxChargeRate);
    }

    @Override
    public long insert(long maxAmount, TransactionContext transaction) {
        var accepted = Math.min(Math.min(maxAmount, chargeRate()), (long) turtle.getEnergyCapacity() - turtle.getEnergyLevel());
        if (accepted <= 0) return 0;
        updateSnapshots(transaction);
        turtle.addEnergy((int) accepted);
        return accepted;
    }

    @Override
    public long extract(long maxAmount, TransactionContext transaction) {
        return 0;
    }

    @Override
    public long getAmount() {
        return turtle.getEnergyLevel();
    }

    @Override
    public long getCapacity() {
        return turtle.getEnergyCapacity();
    }

    @Override
    public boolean supportsInsertion() {
        return chargeRate() > 0;
    }

    @Override
    public boolean supportsExtraction() {
        return false;
    }

    @Override
    protected Integer createSnapshot() {
        return turtle.getEnergyLevel();
    }

    @Override
    protected void readSnapshot(Integer snapshot) {
        turtle.setEnergyLevel(snapshot);
    }
}
