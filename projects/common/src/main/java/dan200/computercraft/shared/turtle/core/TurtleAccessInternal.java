// SPDX-FileCopyrightText: 2023 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.turtle.core;

import dan200.computercraft.api.turtle.ITurtleAccess;
import dan200.computercraft.core.computer.ComputerSide;
import net.minecraft.world.item.ItemStack;

/**
 * An internal version of {@link ITurtleAccess}.
 * <p>
 * This exposes additional functionality we don't want in the public API, but where we don't want access to the full
 * {@link TurtleBrain} interface.
 */
public interface TurtleAccessInternal extends ITurtleAccess {
    /**
     * Get an immutable snapshot of an item in the inventory. This is a thread-safe version of
     * {@code getInventory().getItem()}.
     *
     * @param slot The slot
     * @return The current item. This should NOT be modified.
     * @see net.minecraft.world.Container#getItem(int)
     */
    ItemStack getItemSnapshot(int slot);

    /**
     * Get the maximum Forge Energy a turtle-relative {@code side} will accept per tick (passive charging).
     *
     * @param side The turtle-relative side.
     * @return The charge rate in FE/t; {@code 0} means charging is disabled on that side.
     */
    int getChargeRate(ComputerSide side);

    /**
     * Set the maximum Forge Energy a turtle-relative {@code side} will accept per tick.
     *
     * @param side The turtle-relative side.
     * @param rate The charge rate in FE/t; {@code 0} disables charging on that side.
     */
    void setChargeRate(ComputerSide side, int rate);

    /**
     * Get the maximum Forge Energy a turtle-relative {@code side} will emit per tick (passive discharging).
     *
     * @param side The turtle-relative side.
     * @return The discharge rate in FE/t; {@code 0} means discharging is disabled on that side.
     */
    int getDischargeRate(ComputerSide side);

    /**
     * Set the maximum Forge Energy a turtle-relative {@code side} will emit per tick.
     *
     * @param side The turtle-relative side.
     * @param rate The discharge rate in FE/t; {@code 0} disables discharging on that side.
     */
    void setDischargeRate(ComputerSide side, int rate);
}
