// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.core.CoreConfig;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class JSMachine implements ILuaMachine {
    private final Context cx;
    private final Scriptable scope;
    private final String biosSource;

    private boolean started = false;
    private volatile boolean isDisposed = false;

    // Read the bios eagerly: ComputerExecutor closes the stream in a try-with-resources
    // immediately after construction, before handleEvent() is ever called.
    public JSMachine(MachineEnvironment environment, InputStream bios) throws IOException {
        biosSource = new String(bios.readAllBytes(), StandardCharsets.UTF_8);

        cx = Context.enter();
        cx.setOptimizationLevel(-1);
        cx.setLanguageVersion(Context.VERSION_ES6);
        cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold);
        cx.setClassShutter(className -> false);
        scope = cx.initStandardObjects();
    }

    @Override
    public MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        if (isDisposed) return MachineResult.OK;

        if (!started) {
            started = true;
            try {
                cx.evaluateString(scope, biosSource, "bios.js", 1, null);
            } catch (Exception e) {
                close();
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }

        return MachineResult.OK;
    }

    @Override
    public void printExecutionState(StringBuilder out) {
    }

    @Override
    public void close() {
        if (isDisposed) return;
        isDisposed = true;
        Context.exit();
    }
}
