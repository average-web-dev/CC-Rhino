// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.shared.turtle.upgrades;

import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.api.turtle.ITurtleAccess;
import dan200.computercraft.shared.turtle.core.TurtleCraftCommand;
import org.jspecify.annotations.Nullable;

import java.util.Optional;

/**
 * The workbench peripheral allows you to craft items within the turtle's inventory.
 *
 * @cc.module workbench
 * @hidden
 * @cc.see turtle.craft This uses the {@link CraftingTablePeripheral} peripheral to craft items.
 */
public class CraftingTablePeripheral implements IPeripheral {
    private final ITurtleAccess turtle;

    public CraftingTablePeripheral(ITurtleAccess turtle) {
        this.turtle = turtle;
    }

    @Override
    public String getType() {
        return "workbench";
    }

    @ScriptFunction
    public final MethodResult craft(Optional<Integer> count) throws ScriptException {
        int limit = count.orElse(64);
        if (limit < 0 || limit > 64) throw new ScriptException("Crafting count " + limit + " out of range");
        return turtle.executeCommand(new TurtleCraftCommand(limit));
    }

    @Override
    public boolean equals(@Nullable IPeripheral other) {
        return other instanceof CraftingTablePeripheral;
    }

    @Override
    public Object getTarget() {
        return turtle;
    }
}
