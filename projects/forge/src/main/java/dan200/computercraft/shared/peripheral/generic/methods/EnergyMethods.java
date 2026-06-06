// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.peripheral.generic.methods;

import dan200.computercraft.api.scripting.ScriptFunction;
import net.neoforged.neoforge.energy.IEnergyStorage;

/**
 * Fluid methods for Forge's {@link IEnergyStorage}.
 */
public final class EnergyMethods extends AbstractEnergyMethods<IEnergyStorage> {
    @Override
    @ScriptFunction(mainThread = true)
    public int getEnergy(IEnergyStorage energy) {
        return energy.getEnergyStored();
    }

    @Override
    @ScriptFunction(mainThread = true)
    public int getEnergyCapacity(IEnergyStorage energy) {
        return energy.getMaxEnergyStored();
    }
}
