// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

import dan200.computercraft.core.CoreConfig;
import dan200.computercraft.core.computer.TimeoutState;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.locks.LockSupport;

public class JSMachine implements ILuaMachine {
    private static final String HARD_ABORT_MESSAGE = "hard abort";

    private final CCContextFactory factory;
    private final Context cx;
    private final Scriptable scope;
    private final String biosSource;
    private final JSRequire require;
    private final TimeoutState timeout;

    // Stored by observeInstructionCount so the abort listener can unpark this thread.
    private volatile @Nullable Thread executionThread;
    private @Nullable Runnable abortListener;

    private boolean started = false;
    private volatile boolean isDisposed = false;

    // Read the bios eagerly: ComputerExecutor closes the stream in a try-with-resources
    // immediately after construction, before handleEvent() is ever called.
    public JSMachine(MachineEnvironment environment, InputStream bios) throws IOException {
        biosSource = new String(bios.readAllBytes(), StandardCharsets.UTF_8);
        timeout = environment.timeout();

        factory = new CCContextFactory();
        cx = factory.enterContext();
        scope = cx.initStandardObjects();

        require = new JSRequire(scope, environment.fileSystem());
        var cache = cx.newObject(scope);
        var paths = cx.newArray(scope, new Object[]{ "/rom/apis" });
        ScriptableObject.putProperty(require, "cache", cache);
        ScriptableObject.putProperty(require, "paths", paths);

        // require is the only global — all CC APIs will be loaded through it
        ScriptableObject.putProperty(scope, "require", require);

        // Wake up the pause spin-loop immediately when a hard abort is requested,
        // rather than waiting for the next 1 ms park to expire.
        abortListener = () -> {
            if (timeout.isHardAborted()) {
                var t = executionThread;
                if (t != null) LockSupport.unpark(t);
            }
        };
        timeout.addListener(abortListener);
    }

    public JSRequire getRequire() {
        return require;
    }

    @Override
    public MachineResult handleEvent(@Nullable String eventName, @Nullable Object @Nullable [] arguments) {
        if (isDisposed) return MachineResult.OK;

        if (!started) {
            started = true;
            try {
                cx.evaluateString(scope, biosSource, "bios.js", 1, null);
            } catch (EvaluatorException e) {
                return mapException(e);
            } catch (RhinoException e) {
                close();
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            } catch (Exception e) {
                close();
                return MachineResult.error(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }

        return MachineResult.OK;
    }

    private MachineResult mapException(EvaluatorException e) {
        var msg = e.getMessage();
        if (HARD_ABORT_MESSAGE.equals(msg)) {
            close();
            return MachineResult.TIMEOUT;
        }
        if (TimeoutState.ABORT_MESSAGE.equals(msg)) {
            close();
            return MachineResult.error(TimeoutState.ABORT_MESSAGE);
        }
        close();
        return MachineResult.error(msg != null ? msg : e.toString());
    }

    @Override
    public void printExecutionState(StringBuilder out) {
    }

    @Override
    public void close() {
        if (isDisposed) return;
        isDisposed = true;
        var listener = abortListener;
        if (listener != null) {
            timeout.removeListener(listener);
            abortListener = null;
        }
        Context.exit();
    }

    private final class CCContextFactory extends ContextFactory {
        @Override
        @SuppressWarnings("deprecation") // setOptimizationLevel(-1) = interpreter mode; required for continuations
        protected Context makeContext() {
            var cx = super.makeContext();
            cx.setOptimizationLevel(-1);
            cx.setLanguageVersion(Context.VERSION_ES6);
            cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold);
            cx.setClassShutter(className -> false);
            return cx;
        }

        @Override
        protected void observeInstructionCount(Context cx, int instructionCount) {
            if (isDisposed || timeout.isHardAborted()) {
                throw new EvaluatorException(HARD_ABORT_MESSAGE);
            }
            if (timeout.isSoftAborted()) {
                throw new EvaluatorException(TimeoutState.ABORT_MESSAGE);
            }
            while (timeout.isPaused()) {
                executionThread = Thread.currentThread();
                if (isDisposed || timeout.isHardAborted()) {
                    throw new EvaluatorException(HARD_ABORT_MESSAGE);
                }
                LockSupport.parkNanos(1_000_000L); // 1 ms; listener unparks on hard abort
            }
            executionThread = null;
        }
    }
}
