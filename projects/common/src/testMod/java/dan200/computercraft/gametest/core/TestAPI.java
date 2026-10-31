// SPDX-FileCopyrightText: 2021 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.gametest.core;

import dan200.computercraft.api.component.ComputerComponents;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.IComputerSystem;
import dan200.computercraft.api.scripting.MethodResult;
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
 * Note, the test bios extends this API with assertion helpers (see {@code ManagedComputers.TEST_BIOS}).
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
        // Set the error before the marker, so a reader which sees DONE also sees the failure.
        error = message;
        markers.add(ComputerState.DONE);
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

    /**
     * Queue an event on this computer, as if it came from outside (for instance {@code terminate} from Ctrl+C).
     *
     * @param event The name of the event to queue.
     */
    @ScriptFunction
    public final void queueEvent(String event) {
        system.queueEvent(event);
    }

    /**
     * Run a turtle command whose {@link dan200.computercraft.api.turtle.TurtleCommand#execute} throws, as a buggy
     * addon command might.
     *
     * @param message The message of the thrown exception.
     * @return The command's result, which is never produced: the call should throw {@code message} instead.
     * @throws ScriptException If this computer is not a turtle.
     */
    @ScriptFunction
    public final MethodResult runFaultyTurtleCommand(String message) throws ScriptException {
        var turtle = system.getComponent(ComputerComponents.TURTLE);
        if (turtle == null) throw new ScriptException("Not a turtle");
        return turtle.executeCommand(t -> {
            throw new IllegalStateException(message);
        });
    }
}
