// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.platform;

/**
 * A loader-neutral view of a neighbouring block's energy storage, used by turtles to actively push/pull
 * Forge Energy. Backed by NeoForge's {@code IEnergyStorage}; on loaders without Forge Energy there is no
 * implementation and {@link PlatformHelper#getEnergyStorage} returns {@code null}.
 */
public interface EnergyHandle {
    /**
     * Insert energy into the storage.
     *
     * @param amount   The maximum amount to insert.
     * @param simulate If {@code true}, only report what would be inserted without changing anything.
     * @return The amount actually (or that would be) inserted.
     */
    int receiveEnergy(int amount, boolean simulate);

    /**
     * Extract energy from the storage.
     *
     * @param amount   The maximum amount to extract.
     * @param simulate If {@code true}, only report what would be extracted without changing anything.
     * @return The amount actually (or that would be) extracted.
     */
    int extractEnergy(int amount, boolean simulate);
}
