// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import dan200.computercraft.core.terminal.Terminal;

import java.util.ArrayList;
import java.util.List;

/**
 * The screen and keyboard of a computer, as a set of virtual consoles.
 * <p>
 * Each console is a {@link Tty} whose output a {@link TerminalEmulator} renders into its own off-screen buffer; the
 * buffer of the <em>visible</em> console is copied onto the computer's {@link Terminal}, which is what players see.
 * Keyboard, paste and mouse input go to the visible console (through an {@link InputEncoder}). With Alt held, the digit
 * keys 1–9 switch consoles.
 * <p>
 * The screen is inactive until a script {@linkplain #activate() takes it over}: until then it neither draws nor takes
 * input, so code that draws on the terminal directly is not disturbed. Thread-safe: input arrives on the server thread,
 * output on the computer thread.
 */
public final class Screen {
    private static final int KEY_1 = 49;

    private final Terminal display;
    private final int consoleCount;
    private final InputEncoder encoder = new InputEncoder();
    private List<Console> consoles = List.of();
    private int visible;
    private boolean active;

    /** One virtual console: a TTY and the emulator rendering it into an off-screen buffer. */
    public final class Console {
        private final int index;
        private final Tty tty;
        private final Terminal buffer;
        private final TerminalEmulator emulator;

        private Console(int index) {
            this.index = index;
            tty = new Tty(display.getWidth(), display.getHeight(), display.isColour());
            buffer = new Terminal(display.getWidth(), display.getHeight(), display.isColour());
            emulator = new TerminalEmulator(buffer);
            tty.setColumnSource(buffer::getCursorX);
            tty.attach(text -> {
                emulator.writeOut(text);
                rendered(this);
            }, text -> {
                emulator.writeErr(text);
                rendered(this);
            });
        }

        /** The position of this console, starting at 0. */
        public int index() {
            return index;
        }

        public Tty tty() {
            return tty;
        }

        public TerminalEmulator emulator() {
            return emulator;
        }

        /** The off-screen buffer this console renders into. */
        public Terminal buffer() {
            return buffer;
        }
    }

    /**
     * @param display      The computer's terminal.
     * @param consoleCount The number of virtual consoles (1 for a normal computer).
     */
    public Screen(Terminal display, int consoleCount) {
        if (consoleCount < 1) throw new IllegalArgumentException("a screen needs at least one console");
        this.display = display;
        this.consoleCount = consoleCount;
        reset();
    }

    /** Recreate the consoles (the computer turned on, rebooted or shut down) and deactivate the screen. */
    public synchronized void reset() {
        var list = new ArrayList<Console>(consoleCount);
        for (var i = 0; i < consoleCount; i++) list.add(new Console(i));
        consoles = List.copyOf(list);
        visible = 0;
        active = false;
    }

    /** Take over the computer's terminal: from now on it shows the visible console, and input goes to it. */
    public synchronized void activate() {
        if (active) return;
        active = true;
        copyToDisplay(consoles.get(visible));
    }

    public synchronized boolean isActive() {
        return active;
    }

    public synchronized List<Console> consoles() {
        return consoles;
    }

    public synchronized Console visible() {
        return consoles.get(visible);
    }

    /**
     * Show another console.
     *
     * @param index The console, starting at 0.
     * @return Whether the index names a console.
     */
    public synchronized boolean show(int index) {
        if (index < 0 || index >= consoles.size()) return false;
        visible = index;
        if (active) copyToDisplay(consoles.get(index));
        return true;
    }

    // ── Input ────────────────────────────────────────────────────────────────────

    public void keyDown(int key) {
        String data;
        Tty tty;
        synchronized (this) {
            if (!active) {
                encoder.keyDown(key);
                return;
            }
            // Alt+1 … Alt+9 switch consoles, even while the program on the visible one hangs.
            if (encoder.isAlt() && !encoder.isCtrl() && key >= KEY_1 && key < KEY_1 + 9 && consoles.size() > 1) {
                show(key - KEY_1);
                return;
            }
            data = encoder.keyDown(key);
            tty = consoles.get(visible).tty;
        }
        if (data != null) tty.input(data);
    }

    public synchronized void keyUp(int key) {
        encoder.keyUp(key);
    }

    public void charTyped(char ch) {
        String data;
        Tty tty;
        synchronized (this) {
            if (!active) return;
            // The digit of an Alt+digit switch also arrives as a character.
            if (encoder.isAlt() && !encoder.isCtrl() && ch >= '1' && ch <= '9' && consoles.size() > 1) return;
            data = encoder.charTyped(ch);
            tty = consoles.get(visible).tty;
        }
        if (data != null) tty.input(data);
    }

    public void paste(String text) {
        Tty tty;
        synchronized (this) {
            if (!active) return;
            tty = consoles.get(visible).tty;
        }
        tty.input(text);
    }

    public void mouse(InputEncoder.Mouse kind, int button, int x, int y) {
        String data;
        Tty tty;
        synchronized (this) {
            if (!active) return;
            var console = consoles.get(visible);
            var emulator = console.emulator;
            data = encoder.mouse(kind, button, x, y, emulator.mouseMode(), emulator.sgrMouse());
            tty = console.tty;
        }
        if (data != null) tty.input(data);
    }

    // ── Output ───────────────────────────────────────────────────────────────────

    /** A console rendered something: if it is visible, show it. */
    private synchronized void rendered(Console console) {
        if (active && consoles.get(visible) == console) copyToDisplay(console);
    }

    private void copyToDisplay(Console console) {
        var buffer = console.buffer;
        synchronized (buffer) {
            var height = Math.min(buffer.getHeight(), display.getHeight());
            for (var y = 0; y < height; y++) {
                display.setLine(y, buffer.getLine(y).toString(), buffer.getTextColourLine(y).toString(),
                    buffer.getBackgroundColourLine(y).toString());
            }
            display.setCursorPos(buffer.getCursorX(), buffer.getCursorY());
            display.setCursorBlink(buffer.getCursorBlink());
            display.setTextColour(buffer.getTextColour());
            display.setBackgroundColour(buffer.getBackgroundColour());
        }
    }
}
