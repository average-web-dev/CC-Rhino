// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.core.computer.TimeoutState;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.HostAccess;
import org.graalvm.polyglot.Source;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * A JavaScript-based machine implementation using GraalJS.
 * Replaces {@link CobaltLuaMachine} with an ES6 JavaScript engine.
 */
public class JSMachine implements ILuaMachine, AutoCloseable {
    private static final Logger LOG = LoggerFactory.getLogger(JSMachine.class);

    private static final Engine SHARED_ENGINE = Engine.newBuilder("js")
        .option("engine.WarnInterpreterOnly", "false")
        .build();

    private final TimeoutState timeout;
    private final Runnable timeoutListener = this::onTimeoutChanged;

    private final Context context;
    private @Nullable Source biosSource;

    private volatile boolean isDisposed = false;
    private boolean biosExecuted = false;

    public JSMachine(MachineEnvironment environment, InputStream bios) throws MachineException {
        timeout = environment.timeout();

        context = Context.newBuilder("js")
            .engine(SHARED_ENGINE)
            .allowHostAccess(HostAccess.ALL)
            .allowHostClassLookup(className -> true)
            .allowExperimentalOptions(true)
            .option("js.esm-eval-returns-exports", "true")
            .build();

        // Temporary print shim so bios.js can call print() before Phase 5 wires the real term API
        context.eval("js", "globalThis.print = (...args) => { java.lang.System.out.println(args.join('\\t')); };");

        // TODO Phase 3: attach ResourceLimits for safepoint
        // TODO Phase 4: inject EventEmitter
        // TODO Phase 5: expose ILuaAPI objects as JS globals
        // TODO Phase 6: register JSFileSystem

        // Load and compile bios.js — execution deferred to first handleEvent call
        try {
            var reader = new InputStreamReader(bios, StandardCharsets.UTF_8);
            biosSource = Source.newBuilder("js", reader, "bios.js").build();
        } catch (IOException e) {
            throw new MachineException("Failed to read bios.js: " + e.getMessage());
        }

        timeout.addListener(timeoutListener);
    }

    private void onTimeoutChanged() {
        if (isDisposed) return;
        if (timeout.isHardAborted()) {
            try {
                context.interrupt(java.time.Duration.ZERO);
            } catch (java.util.concurrent.TimeoutException e) {
                // Interrupt request sent; context will cancel at next safepoint
            }
        }
    }

    @Override
    public MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        if (isDisposed) throw new IllegalStateException("Machine has been closed");

        // First call (eventName == null) runs the bios
        if (!biosExecuted) {
            biosExecuted = true;
            var src = biosSource;
            biosSource = null;
            if (src != null) {
                try {
                    context.eval(src);
                } catch (Exception e) {
                    LOG.warn("Error executing bios.js", e);
                    close();
                    return MachineResult.error(e.getMessage() != null ? e.getMessage() : "Error in bios.js");
                }
            }
        }

        // TODO Phase 4: dispatch event to JS EventEmitter
        return MachineResult.OK;
    }

    @Override
    public void printExecutionState(StringBuilder out) {
        out.append("JSMachine: isDisposed=").append(isDisposed).append('\n');
    }

    @Override
    public void close() {
        isDisposed = true;
        timeout.removeListener(timeoutListener);
        try {
            context.close(true);
        } catch (Exception e) {
            LOG.debug("Exception while closing JS context", e);
        }
    }
}
