// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL
package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.computer.ComputerSide;
import dan200.computercraft.core.redstone.RedstoneAccess;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A base class for all blocks with redstone integration.
 */
public class RedstoneMethods {
    private final RedstoneAccess redstone;

    public RedstoneMethods(RedstoneAccess redstone) {
        this.redstone = redstone;
    }

    /**
     * Turn the redstone signal of a specific side on or off.
     *
     * @param side The side to set.
     * @param on   Whether the redstone signal should be on or off. When on, a signal strength of 15 is emitted.
     */
    @ScriptFunction
    public final void setOutput(ComputerSide side, boolean on) {
        redstone.setOutput(side, on ? 15 : 0);
    }

    /**
     * Get the current redstone output of a specific side.
     *
     * @param side The side to get.
     * @return Whether the redstone output is on or off.
     * @see #setOutput
     */
    @ScriptFunction
    public final boolean getOutput(ComputerSide side) {
        return redstone.getOutput(side) > 0;
    }

    /**
     * Get the current redstone input of a specific side.
     *
     * @param side The side to get.
     * @return Whether the redstone input is on or off.
     */
    @ScriptFunction
    public final boolean getInput(ComputerSide side) {
        return redstone.getInput(side) > 0;
    }

    /**
     * Set the redstone signal strength for a specific side.
     *
     * @param side  The side to set.
     * @param value The signal strength between 0 and 15.
     * @throws ScriptException If {@code value} is not between 0 and 15.
     * @cc.since 1.51
     */
    @ScriptFunction({ "setAnalogOutput", "setAnalogueOutput" })
    public final void setAnalogOutput(ComputerSide side, int value) throws ScriptException {
        if (value < 0 || value > 15) throw new ScriptException("Expected number in range 0-15");
        redstone.setOutput(side, value);
    }

    /**
     * Get the redstone output signal strength for a specific side.
     *
     * @param side The side to get.
     * @return The output signal strength, between 0 and 15.
     * @cc.since 1.51
     * @see #setAnalogOutput
     */
    @ScriptFunction({ "getAnalogOutput", "getAnalogueOutput" })
    public final int getAnalogOutput(ComputerSide side) {
        return redstone.getOutput(side);
    }

    /**
     * Get the redstone input signal strength for a specific side.
     *
     * @param side The side to get.
     * @return The input signal strength, between 0 and 15.
     * @cc.since 1.51
     */
    @ScriptFunction({ "getAnalogInput", "getAnalogueInput" })
    public final int getAnalogInput(ComputerSide side) {
        return redstone.getInput(side);
    }

    /**
     * Turn channels of the bundled cable output on a specific side on or off: the channels named in {@code states}
     * change, the others stay as they are.
     *
     * @param side   The side to set.
     * @param states The new state of each channel to change, keyed by dye ({@code Dye} from the {@code color} module).
     * @throws ScriptException If a key is not a channel (0–15), a value not a boolean, or {@code states} is an array.
     * @cc-r.param states Partial<Record<Dye, boolean>>
     * @cc.usage Turn the red channel on behind the computer and the blue one off, then red off again.
     * <pre>{@code
     * redstone.setBundledOutput("back", { [Dye.RED]: true, [Dye.BLUE]: false });
     * redstone.setBundledOutput("back", { [Dye.RED]: false });
     * }</pre>
     */
    @ScriptFunction
    public final void setBundledOutput(ComputerSide side, Map<?, ?> states) throws ScriptException {
        int on = 0, off = 0;
        for (var entry : states.entrySet()) {
            var bit = 1 << channelOf(entry.getKey());
            if (!(entry.getValue() instanceof Boolean value)) {
                throw new ScriptException("Bundled channel " + entry.getKey() + " must be true or false");
            }
            if (value) on |= bit; else off |= bit;
        }
        redstone.setBundledOutput(side, (redstone.getBundledOutput(side) | on) & ~off);
    }

    /**
     * Turn all 16 channels of the bundled cable output on a specific side on or off.
     *
     * @param side The side to set.
     * @param on   Whether all channels should be on.
     */
    @ScriptFunction
    public final void setAllBundledOutput(ComputerSide side, boolean on) {
        redstone.setBundledOutput(side, on ? 0xFFFF : 0);
    }

    /**
     * Get the bundled cable output for a specific side.
     *
     * @param side The side to get.
     * @return Whether each of the 16 channels is on, keyed by dye: {@code getBundledOutput("back")[Dye.RED]}.
     * @cc-r.return Record<Dye, boolean>
     */
    @ScriptFunction
    public final Map<Integer, Boolean> getBundledOutput(ComputerSide side) {
        return toStates(redstone.getBundledOutput(side));
    }

    /**
     * Get the bundled cable input for a specific side.
     *
     * @param side The side to get.
     * @return Whether each of the 16 channels is on, keyed by dye: {@code getBundledInput("back")[Dye.RED]}.
     * @cc-r.return Record<Dye, boolean>
     */
    @ScriptFunction
    public final Map<Integer, Boolean> getBundledInput(ComputerSide side) {
        return toStates(redstone.getBundledInput(side));
    }

    /** The channel (0–15) a key of a states object names (objects reach Java with string keys, arrays with numbers). */
    private static int channelOf(Object key) throws ScriptException {
        if (key instanceof String text && text.matches("[0-9]{1,2}")) {
            var channel = Integer.parseInt(text);
            if (channel <= 15) return channel;
        }
        throw new ScriptException(key instanceof String
            ? "Bundled channel must be a dye (0-15), got " + key
            : "Bundled channels must be an object keyed by dye ({ [Dye.RED]: true }), not an array");
    }

    /** Whether each channel (0–15) is on in a bit mask, keyed by channel. */
    private static Map<Integer, Boolean> toStates(int mask) {
        var states = new LinkedHashMap<Integer, Boolean>();
        for (var channel = 0; channel < 16; channel++) states.put(channel, (mask & (1 << channel)) != 0);
        return states;
    }
}
