// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.shared.turtle.apis;

import dan200.computercraft.TestPlatformHelper;
import dan200.computercraft.core.computer.ComputerSide;
import dan200.computercraft.core.metrics.MetricsObserver;
import dan200.computercraft.shared.config.Config;
import dan200.computercraft.shared.platform.EnergyHandle;
import dan200.computercraft.shared.turtle.core.TurtleAccessInternal;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Tests {@link TurtleAPI#transferEnergy} and {@link TurtleAPI#absorbEnergy}.
 *
 * @see <a href="https://github.com/average-web-dev/CC-Rhino/issues/21">#21</a>
 */
public class TurtleAPIEnergyTest {
    private static final int CAPACITY = 1000;

    private boolean needFuel;
    private int maxCharge;
    private int maxDischarge;

    private final FakeTurtle turtle = new FakeTurtle();
    private final FakeStorage neighbour = new FakeStorage();
    private final TurtleAPI api = new TurtleAPI(MetricsObserver.discard(), turtle.proxy());

    @BeforeEach
    public void setup() {
        needFuel = Config.turtlesNeedFuel;
        maxCharge = Config.turtleMaxChargeRate;
        maxDischarge = Config.turtleMaxDischargeRate;
        Config.turtlesNeedFuel = true;
        Config.turtleMaxChargeRate = Integer.MAX_VALUE;
        Config.turtleMaxDischargeRate = Integer.MAX_VALUE;
        TestPlatformHelper.energyStorage = neighbour;
    }

    @AfterEach
    public void tearDown() {
        Config.turtlesNeedFuel = needFuel;
        Config.turtleMaxChargeRate = maxCharge;
        Config.turtleMaxDischargeRate = maxDischarge;
        TestPlatformHelper.energyStorage = null;
    }

    @Test
    public void transferMovesEnergy() {
        turtle.energy = 100;
        assertEquals(80, api.transferEnergy(ComputerSide.FRONT, 80));
        assertEquals(20, turtle.energy);
        assertEquals(80, neighbour.stored);
    }

    @Test
    public void transferIsLimitedByStoredEnergy() {
        turtle.energy = 30;
        assertEquals(30, api.transferEnergy(ComputerSide.FRONT, 80));
        assertEquals(0, turtle.energy);
        assertEquals(30, neighbour.stored);
    }

    @Test
    public void transferDoesNothingWithoutFuelRequirement() {
        Config.turtlesNeedFuel = false;
        turtle.energy = 80;
        for (var i = 0; i < 10; i++) assertEquals(0, api.transferEnergy(ComputerSide.FRONT, 80));
        assertEquals(80, turtle.energy);
        assertEquals(0, neighbour.stored);
    }

    @Test
    public void transferIsCappedByMaxDischargeRate() {
        Config.turtleMaxDischargeRate = 25;
        turtle.energy = 100;
        assertEquals(25, api.transferEnergy(ComputerSide.FRONT, 80));
        assertEquals(75, turtle.energy);
        assertEquals(25, neighbour.stored);
    }

    @Test
    public void transferIgnoresPerSideDischargeRate() {
        turtle.dischargeRate = 0;
        turtle.energy = 100;
        assertEquals(50, api.transferEnergy(ComputerSide.FRONT, 50));
    }

    @Test
    public void transferNeverDeliversMoreThanConsumed() {
        neighbour.overReport = true;
        turtle.energy = 100;
        assertEquals(40, api.transferEnergy(ComputerSide.FRONT, 40));
        assertEquals(60, turtle.energy);
    }

    @Test
    public void transferWithoutNeighbour() {
        TestPlatformHelper.energyStorage = null;
        turtle.energy = 100;
        assertEquals(0, api.transferEnergy(ComputerSide.FRONT, 40));
        assertEquals(100, turtle.energy);
    }

    @Test
    public void absorbMovesEnergy() {
        neighbour.stored = 500;
        assertEquals(200, api.absorbEnergy(ComputerSide.BACK, 200));
        assertEquals(200, turtle.energy);
        assertEquals(300, neighbour.stored);
    }

    @Test
    public void absorbIsLimitedByFreeCapacity() {
        neighbour.stored = 500;
        turtle.energy = CAPACITY - 50;
        assertEquals(50, api.absorbEnergy(ComputerSide.BACK, 200));
        assertEquals(CAPACITY, turtle.energy);
        assertEquals(450, neighbour.stored);
    }

    @Test
    public void absorbDoesNothingWithoutFuelRequirement() {
        Config.turtlesNeedFuel = false;
        neighbour.stored = 500;
        assertEquals(0, api.absorbEnergy(ComputerSide.BACK, 200));
        assertEquals(0, turtle.energy);
        assertEquals(500, neighbour.stored);
    }

    @Test
    public void absorbIsCappedByMaxChargeRate() {
        Config.turtleMaxChargeRate = 60;
        neighbour.stored = 500;
        assertEquals(60, api.absorbEnergy(ComputerSide.BACK, 200));
        assertEquals(60, turtle.energy);
        assertEquals(440, neighbour.stored);
    }

    @Test
    public void absorbNeverAddsMoreThanRequested() {
        neighbour.overReport = true;
        neighbour.stored = 500;
        assertEquals(70, api.absorbEnergy(ComputerSide.BACK, 70));
        assertEquals(70, turtle.energy);
    }

    /** The subset of a turtle's energy behaviour {@link TurtleAPI} uses, mirroring {@code TurtleBrain}. */
    private static final class FakeTurtle {
        int energy;
        int dischargeRate;

        TurtleAccessInternal proxy() {
            return (TurtleAccessInternal) Proxy.newProxyInstance(
                TurtleAccessInternal.class.getClassLoader(), new Class<?>[]{ TurtleAccessInternal.class },
                (self, method, args) -> switch (method.getName()) {
                    case "isEnergyNeeded" -> Config.turtlesNeedFuel;
                    case "getEnergyLevel" -> energy;
                    case "getEnergyCapacity" -> CAPACITY;
                    case "consumeEnergy" -> consume((Integer) args[0]);
                    case "addEnergy" -> {
                        energy = Math.min(energy + Math.max((Integer) args[0], 0), CAPACITY);
                        yield null;
                    }
                    case "getDischargeRate" -> dischargeRate;
                    case "getDirection" -> Direction.NORTH;
                    case "getPosition" -> BlockPos.ZERO;
                    case "getLevel" -> null;
                    default -> throw new UnsupportedOperationException(method.getName());
                }
            );
        }

        private boolean consume(int amount) {
            if (!Config.turtlesNeedFuel) return true;
            if (energy < amount) return false;
            energy -= amount;
            return true;
        }
    }

    /** A neighbouring energy store with unlimited capacity, which may report more than it was asked to move. */
    private static final class FakeStorage implements EnergyHandle {
        int stored;
        boolean overReport;

        @Override
        public int receiveEnergy(int amount, boolean simulate) {
            if (!simulate) stored += amount;
            return overReport ? amount * 2 : amount;
        }

        @Override
        public int extractEnergy(int amount, boolean simulate) {
            var extracted = Math.min(amount, stored);
            if (!simulate) stored -= extracted;
            return overReport ? extracted * 2 : extracted;
        }
    }
}
