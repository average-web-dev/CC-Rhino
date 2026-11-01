// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.shared.peripheral.modem.wired;

import dan200.computercraft.api.network.PacketNetwork;
import dan200.computercraft.api.network.wired.WiredNode;
import dan200.computercraft.api.network.wired.WiredSender;
import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.api.peripheral.NotAttachedException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.shared.peripheral.modem.ModemPeripheral;
import dan200.computercraft.shared.peripheral.modem.ModemState;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * A wired modem: a {@link ModemPeripheral modem} which also attaches the peripherals on its wired network to its
 * computers. They are devices of the computer like those on its sides (same ids, same {@code peripheral} calls).
 *
 * @cc.module modem
 */
public abstract class WiredModemPeripheral extends ModemPeripheral implements WiredSender {
    private static final Logger LOG = LoggerFactory.getLogger(WiredModemPeripheral.class);

    private final WiredModemElement modem;
    private final WiredModemLocalPeripheral localPeripheral;
    private final BlockEntity target;

    /** The computers this modem is attached to, which see the remote peripherals as their own devices. */
    private final Set<IComputerAccess> computers = new HashSet<>(1);

    public WiredModemPeripheral(
        ModemState state,
        WiredModemElement modem,
        WiredModemLocalPeripheral localPeripheral,
        BlockEntity target
    ) {
        super(state);
        this.modem = modem;
        this.localPeripheral = localPeripheral;
        this.target = target;
    }

    //region IPacketSender implementation
    @Override
    public boolean isInterdimensional() {
        return true;
    }

    @Override
    public double getRange() {
        return Integer.MAX_VALUE;
    }

    @Override
    protected PacketNetwork getNetwork() {
        return modem.getNode();
    }

    @Override
    public Level getLevel() {
        return modem.getLevel();
    }
    //endregion

    //region Peripheral methods

    /**
     * Returns the network name of the current computer, if the modem is on. This
     * may be used by other computers on the network to wrap this computer as a
     * peripheral.
     * <p>
     * > [!NOTE]
     * > This function only appears on wired modems. Check {@link #isWireless} returns false before calling it.
     *
     * @return The current computer's name.
     * @cc.since 1.80pr1.7
     */
    @ScriptFunction
    public final @Nullable String getNameLocal() {
        return localPeripheral.getConnectedName();
    }

    @Override
    @SuppressWarnings("UnsynchronizedOverridesSynchronized")
    public void attach(IComputerAccess computer) {
        super.attach(computer);
        synchronized (computers) {
            computers.add(computer);
        }

        Map<String, IPeripheral> remote;
        synchronized (modem.getRemotePeripherals()) {
            remote = Map.copyOf(modem.getRemotePeripherals());
        }
        for (var entry : remote.entrySet()) attachTo(computer, entry.getKey(), entry.getValue());
    }

    @Override
    @SuppressWarnings("UnsynchronizedOverridesSynchronized")
    public void detach(IComputerAccess computer) {
        // The computer detaches the devices this modem attached to it.
        synchronized (computers) {
            computers.remove(computer);
        }
        super.detach(computer);
    }

    @Override
    public final boolean equals(@Nullable IPeripheral other) {
        return other instanceof WiredModemPeripheral otherModem && otherModem.modem == modem;
    }

    @Override
    public final Object getTarget() {
        return target;
    }
    //endregion

    @Override
    public WiredNode getNode() {
        return modem.getNode();
    }

    public void attachPeripheral(String name, IPeripheral peripheral) {
        for (var computer : computers()) attachTo(computer, name, peripheral);
    }

    public void detachPeripheral(String name) {
        for (var computer : computers()) {
            try {
                computer.detachDevice(name);
            } catch (NotAttachedException ignored) {
                // Detached meanwhile: the computer dropped the device with this modem.
            }
        }
    }

    private List<IComputerAccess> computers() {
        synchronized (computers) {
            return List.copyOf(computers);
        }
    }

    /** Attach a remote peripheral to a computer, as one of its devices (by its device id). */
    private void attachTo(IComputerAccess computer, String name, IPeripheral peripheral) {
        if (name.equals(localPeripheral.getConnectedName())) return;
        try {
            computer.attachDevice(name, peripheral);
        } catch (NotAttachedException e) {
            LOG.debug("Computer detached while attaching {}", name, e);
        }
    }
}
