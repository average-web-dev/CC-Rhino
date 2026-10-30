// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.tty;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.apis.IAPIEnvironment;
import dan200.computercraft.core.tty.Screen;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * The screen of the computer, as a set of virtual consoles: each one is a TTY whose output is shown on the screen while
 * it is the visible one. A normal computer has a single console, an advanced computer several (Alt+1 … Alt+9 switch
 * between them).
 * <p>
 * The screen shows nothing of the consoles until {@link #activate()} is called (the bios does this when it boots).
 *
 * @cc.module screen
 */
public class ScreenAPI implements IComputerAPI {
    private final IAPIEnvironment environment;
    private final Map<Screen.Console, TtyHandle> handles = new IdentityHashMap<>();

    public ScreenAPI(IAPIEnvironment environment) {
        this.environment = environment;
    }

    @Override
    public String[] getNames() {
        return new String[]{ "screen" };
    }

    @Override
    public void shutdown() {
        synchronized (handles) {
            handles.clear();
        }
    }

    private Screen screen() {
        return environment.getScreen();
    }

    private TtyHandle handle(Screen.Console console) {
        synchronized (handles) {
            return handles.computeIfAbsent(console, c -> new TtyHandle(environment, c.tty(), false));
        }
    }

    /**
     * Take over the screen: from now on it shows the visible console, and keyboard and mouse input go to it.
     */
    @ScriptFunction
    public final void activate() {
        screen().activate();
    }

    /**
     * Whether the screen shows the consoles yet.
     *
     * @return Whether {@link #activate()} was called.
     */
    @ScriptFunction
    public final boolean isActive() {
        return screen().isActive();
    }

    /**
     * The TTYs of the virtual consoles, in order.
     *
     * @return The consoles.
     */
    @ScriptFunction
    public final List<TtyHandle> getConsoles() {
        var out = new ArrayList<TtyHandle>();
        for (var console : screen().consoles()) out.add(handle(console));
        return out;
    }

    /**
     * The TTY of a virtual console.
     *
     * @param index The console, starting at 0.
     * @return The console's TTY.
     * @throws ScriptException If there is no such console.
     */
    @ScriptFunction
    public final TtyHandle getConsole(int index) throws ScriptException {
        var consoles = screen().consoles();
        if (index < 0 || index >= consoles.size()) throw new ScriptException("No such console: " + index);
        return handle(consoles.get(index));
    }

    /**
     * The number of virtual consoles.
     *
     * @return The number of consoles.
     */
    @ScriptFunction
    public final int getConsoleCount() {
        return screen().consoles().size();
    }

    /**
     * The console that is shown.
     *
     * @return Its index, starting at 0.
     */
    @ScriptFunction
    public final int getVisible() {
        return screen().visible().index();
    }

    /**
     * Show another console.
     *
     * @param index The console, starting at 0.
     * @throws ScriptException If there is no such console.
     */
    @ScriptFunction
    public final void show(int index) throws ScriptException {
        if (!screen().show(index)) throw new ScriptException("No such console: " + index);
    }

    /**
     * Whether the screen can show colours (an advanced computer).
     *
     * @return Whether colours are shown.
     */
    @ScriptFunction
    public final boolean isColor() {
        return environment.getTerminal().isColour();
    }
}
