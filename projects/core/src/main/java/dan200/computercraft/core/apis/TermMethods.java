// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.Coerced;
import dan200.computercraft.api.scripting.IArguments;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.core.terminal.Palette;
import dan200.computercraft.core.terminal.Terminal;

import java.nio.ByteBuffer;

/**
 * A base class for all objects which interact with a terminal. Namely the {@link TermAPI} and monitors.
 *
 * @cc.module term.Redirect
 */
public abstract class TermMethods {
    /** A cursor position on the terminal. Coordinates are 0-based, so {@code (0, 0)} is the top-left cell. */
    public record CursorPosition(int x, int y) {
    }

    /** The size of a terminal, in cells. */
    public record TermSize(int width, int height) {
    }

    /** An RGB colour, each channel between 0 and 1. */
    public record RGB(double r, double g, double b) {
    }

    private static int getHighestBit(int group) {
        // Equivalent to log2(group) - 1.
        return 32 - Integer.numberOfLeadingZeros(group);
    }

    public abstract Terminal getTerminal() throws ScriptException;

    /**
     * Write {@code text} at the current cursor position, moving the cursor to the end of the text.
     * <p>
     * Unlike functions like {@code write} and {@code print}, this does not wrap the text - it simply copies the
     * text to the current terminal line.
     *
     * @param textA The text to write.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final void write(Coerced<String> textA) throws ScriptException {
        var text = textA.value();
        var terminal = getTerminal();
        synchronized (terminal) {
            terminal.write(text);
            terminal.setCursorPos(terminal.getCursorX() + text.length(), terminal.getCursorY());
        }
    }

    /**
     * Move all positions up (or down) by {@code y} pixels.
     * <p>
     * Every pixel in the terminal will be replaced by the line {@code y} pixels below it. If {@code y} is negative, it
     * will copy pixels from above instead.
     *
     * @param y The number of lines to move up by. This may be a negative number.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final void scroll(int y) throws ScriptException {
        getTerminal().scroll(y);
    }

    /**
     * Get the position of the cursor. Coordinates are 0-based, so {@code { x: 0, y: 0 }} is the top-left cell.
     *
     * @return The cursor's position, as an object with {@code x} and {@code y} fields.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final CursorPosition getCursorPos() throws ScriptException {
        var terminal = getTerminal();
        return new CursorPosition(terminal.getCursorX(), terminal.getCursorY());
    }

    /**
     * Set the position of the cursor. {@link #write(Coerced) terminal writes} will begin from this position.
     * <p>
     * The position is given as an object in the same shape {@link #getCursorPos()} returns
     * ({@code setCursorPos({ x, y })}). Coordinates are 0-based.
     *
     * @param pos The new cursor position, as an object with {@code x} and {@code y} fields.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final void setCursorPos(CursorPosition pos) throws ScriptException {
        var terminal = getTerminal();
        synchronized (terminal) {
            terminal.setCursorPos(pos.x(), pos.y());
        }
    }

    /**
     * Checks if the cursor is currently blinking.
     *
     * @return If the cursor is blinking.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.since 1.80pr1.9
     */
    @ScriptFunction
    public final boolean getCursorBlink() throws ScriptException {
        return getTerminal().getCursorBlink();
    }

    /**
     * Sets whether the cursor should be visible (and blinking) at the current {@link #getCursorPos() cursor position}.
     *
     * @param blink Whether the cursor should blink.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final void setCursorBlink(boolean blink) throws ScriptException {
        var terminal = getTerminal();
        synchronized (terminal) {
            terminal.setCursorBlink(blink);
        }
    }

    /**
     * Get the size of the terminal.
     *
     * @return The terminal's size, as an object with {@code width} and {@code height} fields.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final TermSize getSize() throws ScriptException {
        var terminal = getTerminal();
        return new TermSize(terminal.getWidth(), terminal.getHeight());
    }

    /**
     * Clears the terminal, filling it with the {@link #getBackgroundColour() current background colour}.
     *
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final void clear() throws ScriptException {
        getTerminal().clear();
    }

    /**
     * Clears the line the cursor is currently on, filling it with the {@link #getBackgroundColour() current background
     * colour}.
     *
     * @throws ScriptException (hidden) If the terminal cannot be found.
     */
    @ScriptFunction
    public final void clearLine() throws ScriptException {
        getTerminal().clearLine();
    }

    /**
     * Return the colour that new text will be written as.
     *
     * @return The current text colour.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.see colors For a list of colour constants, returned by this function.
     * @cc.since 1.74
     */
    @ScriptFunction({ "getTextColour", "getTextColor" })
    public final int getTextColour() throws ScriptException {
        return encodeColour(getTerminal().getTextColour());
    }

    /**
     * Set the colour that new text will be written as.
     *
     * @param colourArg The new text colour.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.see colors For a list of colour constants.
     * @cc.since 1.45
     * @cc.changed 1.80pr1 Standard computers can now use all 16 colors, being changed to grayscale on screen.
     */
    @ScriptFunction({ "setTextColour", "setTextColor" })
    public final void setTextColour(int colourArg) throws ScriptException {
        var colour = parseColour(colourArg);
        var terminal = getTerminal();
        synchronized (terminal) {
            terminal.setTextColour(colour);
        }
    }

    /**
     * Return the current background colour. This is used when {@link #write writing text} and {@link #clear clearing}
     * the terminal.
     *
     * @return The current background colour.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.see colors For a list of colour constants, returned by this function.
     * @cc.since 1.74
     */
    @ScriptFunction({ "getBackgroundColour", "getBackgroundColor" })
    public final int getBackgroundColour() throws ScriptException {
        return encodeColour(getTerminal().getBackgroundColour());
    }

    /**
     * Set the current background colour. This is used when {@link #write writing text} and {@link #clear clearing} the
     * terminal.
     *
     * @param colourArg The new background colour.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.see colors For a list of colour constants.
     * @cc.since 1.45
     * @cc.changed 1.80pr1 Standard computers can now use all 16 colors, being changed to grayscale on screen.
     */
    @ScriptFunction({ "setBackgroundColour", "setBackgroundColor" })
    public final void setBackgroundColour(int colourArg) throws ScriptException {
        var colour = parseColour(colourArg);
        var terminal = getTerminal();
        synchronized (terminal) {
            terminal.setBackgroundColour(colour);
        }
    }

    /**
     * Determine if this terminal supports colour.
     * <p>
     * Terminals which do not support colour will still allow writing coloured text/backgrounds, but it will be
     * displayed in greyscale.
     *
     * @return Whether this terminal supports colour.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.since 1.45
     */
    @ScriptFunction({ "isColour", "isColor" })
    public final boolean getIsColour() throws ScriptException {
        return getTerminal().isColour();
    }

    /**
     * Writes {@code text} to the terminal with the specific foreground and background colours.
     * <p>
     * As with {@link #write(Coerced)}, the text will be written at the current cursor location, with the cursor
     * moving to the end of the text.
     * <p>
     * {@code textColour} and {@code backgroundColour} must both be strings the same length as {@code text}. All
     * characters represent a single hexadecimal digit, which is converted to one of CC's colours. For instance,
     * {@code "a"} corresponds to purple.
     *
     * @param text             The text to write.
     * @param textColour       The corresponding text colours.
     * @param backgroundColour The corresponding background colours.
     * @throws ScriptException If the three inputs are not the same length.
     * @cc.see colors For a list of colour constants, and their hexadecimal values.
     * @cc.since 1.74
     * @cc.changed 1.80pr1 Standard computers can now use all 16 colors, being changed to grayscale on screen.
     * @cc.usage Prints "Hello, world!" in rainbow text.
     * <pre>{@code
     * term.blit("Hello, world!","01234456789ab","0000000000000")
     * }</pre>
     */
    @ScriptFunction
    public final void blit(ByteBuffer text, ByteBuffer textColour, ByteBuffer backgroundColour) throws ScriptException {
        if (textColour.remaining() != text.remaining() || backgroundColour.remaining() != text.remaining()) {
            throw new ScriptException("Arguments must be the same length");
        }

        var terminal = getTerminal();
        synchronized (terminal) {
            terminal.blit(text, textColour, backgroundColour);
            terminal.setCursorPos(terminal.getCursorX() + text.remaining(), terminal.getCursorY());
        }
    }

    /**
     * Set the palette for a specific colour.
     * <p>
     * ComputerCraft's palette system allows you to change how a specific colour should be displayed. For instance, you
     * can make [`colors.red`] <em>more red</em> by setting its palette to #FF0000. This does now allow you to draw more
     * colours - you are still limited to 16 on the screen at one time - but you can change <em>which</em> colours are
     * used.
     *
     * @param args The new palette values.
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.tparam [1] number index The colour whose palette should be changed.
     * @cc.tparam number colour A 24-bit integer representing the RGB value of the colour. For instance the integer
     * `0xFF0000` corresponds to the colour #FF0000.
     * @cc.tparam [2] number index The colour whose palette should be changed.
     * @cc.tparam number r The intensity of the red channel, between 0 and 1.
     * @cc.tparam number g The intensity of the green channel, between 0 and 1.
     * @cc.tparam number b The intensity of the blue channel, between 0 and 1.
     * @cc.usage Change the [red colour][`colors.red`] from the default #CC4C4C to #FF0000.
     * <pre>{@code
     * term.setPaletteColour(colors.red, 0xFF0000)
     * term.setTextColour(colors.red)
     * print("Hello, world!")
     * }</pre>
     * @cc.usage As above, but specifying each colour channel separately.
     * <pre>{@code
     * term.setPaletteColour(colors.red, 1, 0, 0)
     * term.setTextColour(colors.red)
     * print("Hello, world!")
     * }</pre>
     * @cc.see colors.unpackRGB To convert from the 24-bit format to three separate channels.
     * @cc.see colors.packRGB To convert from three separate channels to the 24-bit format.
     * @cc.since 1.80pr1
     * @cc-r.params {@code colour: number, hexOrR: number, g?: number, b?: number}
     */
    @ScriptFunction({ "setPaletteColour", "setPaletteColor" })
    public final void setPaletteColour(IArguments args) throws ScriptException {
        var colour = 15 - parseColour(args.getInt(0));
        if (args.count() == 2) {
            var hex = args.getInt(1);
            var rgb = Palette.decodeRGB8(hex);
            setColour(getTerminal(), colour, rgb[0], rgb[1], rgb[2]);
        } else {
            var r = args.getFiniteDouble(1);
            var g = args.getFiniteDouble(2);
            var b = args.getFiniteDouble(3);
            setColour(getTerminal(), colour, r, g, b);
        }
    }

    /**
     * Get the current palette for a specific colour.
     *
     * @param colourArg The colour whose palette should be fetched.
     * @return The resulting colour, as an object with {@code r}, {@code g} and {@code b} fields (each between 0 and 1).
     * @throws ScriptException (hidden) If the terminal cannot be found.
     * @cc.since 1.80pr1
     */
    @ScriptFunction({ "getPaletteColour", "getPaletteColor" })
    public final RGB getPaletteColour(int colourArg) throws ScriptException {
        var colour = 15 - parseColour(colourArg);
        var terminal = getTerminal();
        synchronized (terminal) {
            var colourValues = terminal.getPalette().getColour(colour);
            return new RGB(colourValues[0], colourValues[1], colourValues[2]);
        }
    }

    public static int parseColour(int colour) throws ScriptException {
        if (colour <= 0) throw new ScriptException("Colour out of range");
        colour = getHighestBit(colour) - 1;
        if (colour < 0 || colour > 15) throw new ScriptException("Colour out of range");
        return colour;
    }


    public static int encodeColour(int colour) {
        return 1 << colour;
    }

    public static void setColour(Terminal terminal, int colour, double r, double g, double b) {
        terminal.getPalette().setColour(colour, r, g, b);
        terminal.setChanged();
    }
}
