// SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.gametest.core;

import dan200.computercraft.api.scripting.IComputerSystem;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.gametest.api.ComputerState;
import dan200.computercraft.gametest.api.TestExtensionsKt;
import net.minecraft.gametest.framework.GameTestSequence;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Optional;

/**
 * API exposed to computers to help write tests.
 * <p>
 * Note, we extend this API within startup file of computers (see {@code cctest.lua}).
 *
 * @see TestExtensionsKt#thenComputerOk(GameTestSequence, String, String)   To check tests on the computer have passed.
 */
public class TestAPI extends ComputerState implements IComputerAPI {
    private static final Logger LOG = LoggerFactory.getLogger(TestAPI.class);

    private final IComputerSystem system;
    private @Nullable String label;

    TestAPI(IComputerSystem system) {
        this.system = system;
    }

    @Override
    public void startup() {
        if (label == null) label = system.getLabel();
        if (label == null) {
            label = "#" + system.getID();
            LOG.warn("Computer {} has no label", label);
        }

        LOG.info("Computer '{}' has turned on.", label);
        markers.clear();
        error = null;
        lookup.put(label, this);
    }

    @Override
    public void shutdown() {
        LOG.info("Computer '{}' has shut down.", label);
        if (lookup.get(label) == this) lookup.remove(label);
    }

    @Override
    public String[] getNames() {
        return new String[]{ "test" };
    }

    @ScriptFunction
    public final void fail(String message) throws ScriptException {
        LOG.error("Computer '{}' failed with {}", label, message);
        if (markers.contains(ComputerState.DONE)) throw new ScriptException("Cannot call fail/ok multiple times.");
        markers.add(ComputerState.DONE);
        error = message;
        throw new ScriptException(message);
    }

    @ScriptFunction
    public final void ok(Optional<String> marker) throws ScriptException {
        var actualMarker = marker.orElse(ComputerState.DONE);
        if (markers.contains(ComputerState.DONE) || markers.contains(actualMarker)) {
            throw new ScriptException("Cannot call fail/ok multiple times.");
        }

        markers.add(actualMarker);
    }

    @ScriptFunction
    public final void log(String message) {
        LOG.info("[Computer '{}'] {}", label, message);
    }
}
