// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.shared.config;

import dan200.computercraft.shared.peripheral.monitor.MonitorRenderer;

/**
 * ComputerCraft's global config.
 *
 * @see ConfigSpec The definition of our config values.
 */
public final class Config {
    public static int uploadMaxSize = 512 * 1024; // 512 KB
    public static boolean commandRequireCreative = true;

    public static boolean enableCommandBlock = false;
    public static int modemRange = 64;
    public static int modemHighAltitudeRange = 384;
    public static int modemRangeDuringStorm = 64;
    public static int modemHighAltitudeRangeDuringStorm = 384;
    public static int maxNotesPerTick = 8;
    public static MonitorRenderer monitorRenderer = MonitorRenderer.BEST;
    public static int monitorDistance = 65;
    public static long monitorBandwidth = 1_000_000;

    public static boolean turtlesNeedFuel = true;
    // Turtle power is measured in Forge Energy (FE); these are the FE storage capacities.
    public static int turtleEnergieLimit = 1_200_000;
    public static int advancedTurtleEnergieLimit = 6_000_000;
    // FE drained per movement, and the FE produced per tick of an item's burn time when refuelling
    // (FE = burnTime * factor). Independent: coal (1600 burn) -> 1600 * 30 = 48,000 FE, which at
    // 600 FE/move buys 80 moves.
    public static int turtleEnergyPerMovement = 600;
    public static int turtleFuelToEnergyFactor = 30;
    public static boolean turtlesCanPush = true;

    public static final int DEFAULT_COMPUTER_TERM_WIDTH = 51;
    public static final int DEFAULT_COMPUTER_TERM_HEIGHT = 19;

    public static final int TURTLE_TERM_WIDTH = 39;
    public static final int TURTLE_TERM_HEIGHT = 13;

    public static final int DEFAULT_POCKET_TERM_WIDTH = 26;
    public static final int DEFAULT_POCKET_TERM_HEIGHT = 20;

    public static int monitorWidth = 8;
    public static int monitorHeight = 6;

    public static int uploadNagDelay = 5;

    private Config() {
    }
}
