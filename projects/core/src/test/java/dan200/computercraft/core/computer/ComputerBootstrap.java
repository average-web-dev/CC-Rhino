// SPDX-FileCopyrightText: 2019 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.filesystem.WritableMount;
import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.ComputerContext;
import dan200.computercraft.core.computer.mainthread.MainThread;
import dan200.computercraft.core.computer.mainthread.MainThreadConfig;
import dan200.computercraft.core.filesystem.MemoryMount;
import dan200.computercraft.core.terminal.Terminal;
import dan200.computercraft.test.core.computer.BasicEnvironment;
import org.intellij.lang.annotations.Language;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Assertions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Helper class to run a program on a computer.
 */
public class ComputerBootstrap {
    private static final Logger LOG = LoggerFactory.getLogger(ComputerBootstrap.class);
    private static final int TPS = 20;
    public static final int MAX_TIME = 10;
    private static final int BOOT_TICKS = TPS * 10;

    /**
     * A minimal bios which runs {@code /test.js} instead of booting the ROM. Any error thrown by the test (including
     * timeouts) is reported through {@link AssertApi}, and the computer shuts down once the test finishes.
     */
    private static final String TEST_BIOS = """
        var assertion = require('assertion');
        globalThis.assert = function (value, message) { return assertion.assert(value, message); };
        try {
            require('/test.js');
            assertion.assert(true);
        } catch (e) {
            assertion.assert(false, e != null && e.message !== undefined ? String(e.message) : String(e));
        }
        require('system').shutdown();
        """;

    public static void run(@Language("js") String program, Consumer<Computer> setup, int maxTimes) {
        var mount = new MemoryMount().addFile("test.js", program);
        run(mount, setup, maxTimes);
    }

    public static void run(@Language("js") String program, int maxTimes) {
        run(program, x -> {
        }, maxTimes);
    }

    public static void run(WritableMount mount, Consumer<Computer> setup, int maxTicks) {
        var term = new Terminal(51, 19, true);
        var mainThread = new MainThread(new MainThreadConfig.Basic(Integer.MAX_VALUE, Integer.MAX_VALUE));
        var environment = new BasicEnvironment(mount) {
            @Override
            public InputStream createResourceFile(String domain, String subPath) {
                if (subPath.equals("js/bios.js")) return new ByteArrayInputStream(TEST_BIOS.getBytes(StandardCharsets.UTF_8));
                return super.createResourceFile(domain, subPath);
            }
        };
        var context = ComputerContext.builder(environment).mainThreadScheduler(mainThread).build();
        final var computer = new Computer(context, environment, term, 0);

        var api = new AssertApi();
        computer.addApi(api);

        setup.accept(computer);

        try {
            computer.turnOn();
            var everOn = false;

            for (var tick = 0; tick < TPS * maxTicks; tick++) {
                var start = System.currentTimeMillis();

                computer.tick();
                mainThread.tick();

                if (api.message != null) {
                    LOG.debug("Shutting down due to error");
                    computer.shutdown();
                    Assertions.fail(api.message);
                    return;
                }

                var remaining = (1000 / TPS) - (System.currentTimeMillis() - start);
                if (remaining > 0) Thread.sleep(remaining);

                // Break if the computer was once on, and is now off.
                everOn |= computer.isOn();
                // Booting a JS machine on a cold JVM (first test on CI) can take well over a second, so give it time to
                // turn on before treating "off" as finished.
                if ((everOn || tick > BOOT_TICKS) && !computer.isOn()) break;
            }

            // The computer may report a failure and shut down between two checks of the loop above.
            if (api.message != null) {
                computer.shutdown();
                Assertions.fail(api.message);
                return;
            }

            if (computer.isOn() || !api.didAssert) {
                var builder = new StringBuilder().append("Did not correctly [");
                if (!api.didAssert) builder.append(" assert");
                if (computer.isOn()) builder.append(" shutdown");
                builder.append(" ]\n");

                for (var line = 0; line < 19; line++) {
                    builder.append(String.format("%2d | %" + term.getWidth() + "s |\n", line + 1, term.getLine(line)));
                }

                computer.shutdown();
                Assertions.fail(builder.toString());
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } finally {
            try {
                context.ensureClosed(1, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public static class AssertApi implements IComputerAPI {
        // Written on the computer thread, read by the test loop.
        volatile boolean didAssert;
        volatile @Nullable String message;

        @Override
        public String[] getNames() {
            return new String[]{ "assertion" };
        }

        @ScriptFunction
        public final void log(IArguments arguments) throws ScriptException {
            LOG.info("[Computer] {}", Arrays.toString(arguments.getAll()));
        }

        @ScriptFunction("assert")
        public final Object[] doAssert(IArguments arguments) throws ScriptException {
            didAssert = true;

            var arg = arguments.get(0);
            if (arg == null || arg == Boolean.FALSE) {
                message = arguments.optString(1, "Assertion failed");
                throw new ScriptException(message);
            }

            return arguments.getAll();
        }
    }
}
