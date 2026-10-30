// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.ComputerContext;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.computer.mainthread.MainThread;
import dan200.computercraft.core.computer.mainthread.MainThreadConfig;
import dan200.computercraft.core.filesystem.MemoryMount;
import dan200.computercraft.core.input.EventComputerInput;
import dan200.computercraft.core.terminal.Terminal;
import dan200.computercraft.test.core.computer.BasicEnvironment;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Assertions;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/**
 * Runs a computer with the real ROM (and, unless a custom bios is given, the real bios → OS → bash boot), lets a test
 * type into it and inspect its terminal. Scripts can report values through the {@code probe} module
 * ({@code require('probe').record(value)}).
 */
public final class TerminalHarness implements AutoCloseable {
    public static final int KEY_ENTER = 257;
    public static final int KEY_TAB = 258;
    public static final int KEY_BACKSPACE = 259;
    public static final int KEY_DELETE = 261;
    public static final int KEY_RIGHT = 262;
    public static final int KEY_LEFT = 263;
    public static final int KEY_DOWN = 264;
    public static final int KEY_UP = 265;
    public static final int KEY_HOME = 268;
    public static final int KEY_END = 269;
    public static final int KEY_LEFT_CONTROL = 341;

    private static final int TICK_MILLIS = 50;

    private final Terminal terminal;
    private final MainThread mainThread;
    private final ComputerContext context;
    private final Computer computer;
    /** Input as a player gives it: events, and the visible console of the screen. */
    private final EventComputerInput input;
    private final Probe probe = new Probe();

    private TerminalHarness(MemoryMount mount, @Nullable String bios, int width, int height, boolean colour) {
        terminal = new Terminal(width, height, colour);
        mainThread = new MainThread(new MainThreadConfig.Basic(Integer.MAX_VALUE, Integer.MAX_VALUE));
        var environment = new BasicEnvironment(mount) {
            @Override
            public InputStream createResourceFile(String domain, String subPath) {
                if (bios != null && subPath.equals("js/bios.js")) {
                    return new ByteArrayInputStream(bios.getBytes(StandardCharsets.UTF_8));
                }
                return super.createResourceFile(domain, subPath);
            }
        };
        context = ComputerContext.builder(environment).mainThreadScheduler(mainThread).build();
        computer = new Computer(context, environment, terminal, 0);
        input = new EventComputerInput(computer);
        computer.addApi(probe);
        computer.turnOn();
    }

    /** Boot the real bios (→ /rom/os → bash) with {@code mount} as the computer's drive. */
    public static TerminalHarness boot(MemoryMount mount) {
        return new TerminalHarness(mount, null, 51, 19, true);
    }

    /** Boot a custom bios, with the ROM mounted. */
    public static TerminalHarness boot(MemoryMount mount, String bios, int width, int height, boolean colour) {
        return new TerminalHarness(mount, bios, width, height, colour);
    }

    public void tick() {
        computer.tick();
        mainThread.tick();
        try {
            Thread.sleep(TICK_MILLIS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted", e);
        }
    }

    public void ticks(int count) {
        for (var i = 0; i < count; i++) tick();
    }

    /** Tick until {@code condition} holds, failing with a screen dump after {@code maxTicks}. */
    public void waitFor(String description, Predicate<TerminalHarness> condition, int maxTicks) {
        for (var i = 0; i < maxTicks; i++) {
            if (condition.test(this)) return;
            tick();
        }
        if (condition.test(this)) return;
        Assertions.fail("Timed out waiting for " + description + "\n" + dump() + "\nprobe: " + probe.values);
    }

    public void waitFor(String description, Predicate<TerminalHarness> condition) {
        waitFor(description, condition, 200);
    }

    /** Wait until any row of the screen contains {@code text}. */
    public void waitForText(String text) {
        waitFor("'" + text + "' on screen", h -> h.screen().contains(text));
    }

    /** Wait until {@code count} values have been recorded. */
    public void waitForProbe(int count) {
        waitFor(count + " probe values", h -> h.probe.values.size() >= count);
    }

    /** Type text, one {@code char} event per character. */
    public void type(String text) {
        for (var i = 0; i < text.length(); i++) input.charTyped((byte) text.charAt(i));
    }

    public void paste(String text) {
        input.paste(ByteBuffer.wrap(text.getBytes(StandardCharsets.ISO_8859_1)));
    }

    /** Press and release a key. */
    public void key(int key) {
        input.keyDown(key, false);
        input.keyUp(key);
    }

    /** Press a key while Ctrl is held. */
    public void ctrl(int key) {
        input.keyDown(KEY_LEFT_CONTROL, false);
        input.keyDown(key, false);
        input.keyUp(key);
        input.keyUp(KEY_LEFT_CONTROL);
    }

    /** Type a line and press Enter. */
    public void enter(String line) {
        type(line);
        key(KEY_ENTER);
    }

    public void terminate() {
        computer.queueEvent(new CoreEvents.Terminate());
    }

    /** A row of the screen, without trailing spaces. */
    public String line(int y) {
        return terminal.getLine(y).toString().stripTrailing();
    }

    /** The text colours of a row, one blit character per cell ({@code 0} = white, {@code e} = red, …). */
    public String colours(int y) {
        return terminal.getTextColourLine(y).toString();
    }

    public String screen() {
        var out = new StringBuilder();
        for (var y = 0; y < terminal.getHeight(); y++) out.append(line(y)).append('\n');
        return out.toString();
    }

    /** The row containing {@code text}, or -1. */
    public int rowOf(String text) {
        for (var y = 0; y < terminal.getHeight(); y++) if (line(y).contains(text)) return y;
        return -1;
    }

    public int cursorX() {
        return terminal.getCursorX();
    }

    public int cursorY() {
        return terminal.getCursorY();
    }

    public boolean cursorBlink() {
        return terminal.getCursorBlink();
    }

    public List<Object> probe() {
        return probe.values;
    }

    public boolean isOn() {
        return computer.isOn();
    }

    public String dump() {
        var out = new StringBuilder();
        for (var y = 0; y < terminal.getHeight(); y++) {
            out.append(String.format("%2d | %-" + terminal.getWidth() + "s |\n", y, terminal.getLine(y).toString()));
        }
        return out.toString();
    }

    @Override
    public void close() {
        computer.shutdown();
        for (var i = 0; i < 5 && computer.isOn(); i++) tick();
        try {
            context.ensureClosed(1, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** The {@code probe} module: {@code record(value)} stores a value for the test to check. */
    public static final class Probe implements IComputerAPI {
        final List<Object> values = Collections.synchronizedList(new ArrayList<>());

        @Override
        public String[] getNames() {
            return new String[]{ "probe" };
        }

        @ScriptFunction
        public final void record(IArguments arguments) throws ScriptException {
            values.add(arguments.get(0));
        }
    }
}
