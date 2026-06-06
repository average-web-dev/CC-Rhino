// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.terminal.Terminal;
import dan200.computercraft.core.util.Colour;


/**
 * Interact with a computer's terminal or monitors, writing text and drawing ASCII graphics.
 *
 * <h2>Writing to the terminal</h2>
 * The simplest operation one can perform on a terminal is displaying (or writing) some text. This can be performed with
 * the [`term.write`] method.
 *
 * <pre>{@code
 * term.write("Hello, world!")
 * }</pre>
 * <p>
 * When you write text, this advances the cursor, so the next call to [`term.write`] will write text immediately after
 * the previous one.
 *
 * <pre>{@code
 * term.write("Hello, world!")
 * term.write("Some more text")
 * }</pre>
 * <p>
 * [`term.getCursorPos`] and [`term.setCursorPos`] can be used to manually change the cursor's position.
 * <p>
 * <pre>{@code
 * term.clear()
 *
 * term.setCursorPos({ x: 0, y: 0 }) -- The first column of line 0
 * term.write("First line")
 *
 * term.setCursorPos({ x: 19, y: 1 }) -- The 20th column of line 1
 * term.write("Second line")
 * }</pre>
 * <p>
 * [`term.write`] is a relatively basic and low-level function, and does not handle more advanced features such as line
 * breaks or word wrapping. If you just want to display text to the screen, you probably want to use [`print`] or
 * [`write`] instead.
 *
 * <h2>Colours</h2>
 * So far we've been writing text in black and white. However, advanced computers are also capable of displaying text
 * in a variety of colours, with the [`term.setTextColour`] and [`term.setBackgroundColour`] functions.
 *
 * <pre>{@code
 * print("This text is white")
 * term.setTextColour(colours.green)
 * print("This text is green")
 * }</pre>
 * <p>
 * These functions accept any of the constants from the [`colors`] API. [Combinations of colours][`colors.combine`] may
 * be accepted, but will only display a single colour (typically following the behaviour of [`colors.toBlit`]).
 * <p>
 * The [`paintutils`] API provides several helpful functions for displaying graphics using [`term.setBackgroundColour`].
 *
 * @cc.module term
 */
public class TermAPI extends TermMethods implements IComputerAPI {
    private final Terminal terminal;

    public TermAPI(IAPIEnvironment environment) {
        terminal = environment.getTerminal();
    }

    @Override
    public String[] getNames() {
        return new String[]{ "term" };
    }

    /**
     * Get the default palette value for a colour.
     *
     * @param colour The colour whose palette should be fetched.
     * @return The RGB values, as an object with {@code r}, {@code g} and {@code b} fields (each between 0 and 1).
     * @throws ScriptException When given an invalid colour.
     * @cc.since 1.81.0
     * @see TermMethods#setPaletteColour(IArguments) To change the palette colour.
     */
    @ScriptFunction({ "nativePaletteColour", "nativePaletteColor" })
    public final RGB nativePaletteColour(int colour) throws ScriptException {
        var actualColour = 15 - parseColour(colour);
        var c = Colour.fromInt(actualColour);
        return new RGB(c.getR(), c.getG(), c.getB());
    }

    @Override
    public Terminal getTerminal() {
        return terminal;
    }
}
