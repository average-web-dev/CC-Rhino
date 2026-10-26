// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.shared.peripheral.printer;

import dan200.computercraft.api.scripting.Coerced;
import dan200.computercraft.api.scripting.Result;
import dan200.computercraft.api.scripting.ScriptException;
import dan200.computercraft.api.scripting.ScriptFunction;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.core.apis.TermMethods.CursorPosition;
import dan200.computercraft.core.apis.TermMethods.TermSize;
import dan200.computercraft.core.terminal.Terminal;
import dan200.computercraft.core.util.StringUtil;
import org.jspecify.annotations.Nullable;

import java.util.Optional;

/**
 * The printer peripheral allows printing text onto pages. These pages can then be crafted together into printed pages
 * or books.
 * <p>
 * Printers require ink (one of the coloured dyes) and paper in order to function. Once loaded, a new page can be
 * started with {@link #newPage()}. Then the printer can be used similarly to a normal terminal; {@linkplain
 * #write(Coerced) text can be written}, and {@linkplain #setCursorPos(int, int) the cursor moved}. Once all text has
 * been printed, {@link #endPage()} should be called to finally print the page.
 * <p>
 * ## Recipes
 * <div class="recipe-container">
 *     <mc-recipe recipe="computercraft:printer"></mc-recipe>
 *     <mc-recipe recipe="computercraft:printed_pages"></mc-recipe>
 *     <mc-recipe recipe="computercraft:printed_book"></mc-recipe>
 * </div>
 *
 * @cc.usage Print a page titled "Hello" with a small message on it.
 *
 * <pre>{@code
 * local printer = peripheral.find("printer")
 *
 * -- Start a new page, or print an error.
 * if not printer.newPage() then
 *   error("Cannot start a new page. Do you have ink and paper?")
 * end
 *
 * -- Write to the page
 * printer.setPageTitle("Hello")
 * printer.write("This is my first page")
 * printer.setCursorPos(1, 3)
 * printer.write("This is two lines below.")
 *
 * -- And finally print the page!
 * if not printer.endPage() then
 *   error("Cannot end the page. Is there enough space?")
 * end
 * }</pre>
 * @cc.module printer
 * @cc.see cc.strings.wrap To wrap text before printing it.
 */
public class PrinterPeripheral implements IPeripheral {
    private final PrinterBlockEntity printer;

    public PrinterPeripheral(PrinterBlockEntity printer) {
        this.printer = printer;
    }

    @Override
    public String getType() {
        return "printer";
    }

    // FIXME: There's a theoretical race condition here between getCurrentPage and then using the page. Ideally
    //  we'd lock on the page, consume it, and unlock.

    // FIXME: None of our page modification functions actually mark the tile as dirty, so the page may not be
    //  persisted correctly.

    /**
     * Writes text to the current page.
     *
     * @param textA The value to write to the page.
     * @throws ScriptException If any values couldn't be converted to a string, or if no page is started.
     */
    @ScriptFunction
    public final void write(Coerced<String> textA) throws ScriptException {
        var text = textA.value();
        var page = getCurrentPage();
        page.write(text);
        page.setCursorPos(page.getCursorX() + text.length(), page.getCursorY());
    }

    /**
     * Returns the current position of the cursor on the page.
     *
     * @return The position of the cursor. Like {@code term}, coordinates are 0-based.
     * @throws ScriptException If a page isn't being printed.
     */
    @ScriptFunction
    public final CursorPosition getCursorPos() throws ScriptException {
        var page = getCurrentPage();
        return new CursorPosition(page.getCursorX(), page.getCursorY());
    }

    /**
     * Sets the position of the cursor on the page.
     *
     * @param pos The position to move the cursor to, as returned by {@link #getCursorPos}.
     * @throws ScriptException If a page isn't being printed.
     */
    @ScriptFunction
    public final void setCursorPos(CursorPosition pos) throws ScriptException {
        var page = getCurrentPage();
        page.setCursorPos(pos.x(), pos.y());
    }

    /**
     * Returns the size of the current page.
     *
     * @return The size of the page, in characters.
     * @throws ScriptException If a page isn't being printed.
     */
    @ScriptFunction
    public final TermSize getPageSize() throws ScriptException {
        var page = getCurrentPage();
        return new TermSize(page.getWidth(), page.getHeight());
    }

    /**
     * Starts printing a new page.
     *
     * @return Whether a new page could be started, or why not ({@code "No ink"}, {@code "No paper"} or
     * {@code "Output tray is full"}).
     */
    @ScriptFunction(mainThread = true)
    public final Result newPage() {
        return printer.startNewPage();
    }

    /**
     * Finalizes printing of the current page and outputs it to the tray.
     *
     * @return Whether the page could be output, or why not ({@code "Output tray is full"}).
     * @throws ScriptException If a page isn't being printed.
     */
    @ScriptFunction(mainThread = true)
    public final Result endPage() throws ScriptException {
        getCurrentPage();
        return printer.endCurrentPage();
    }

    /**
     * Sets the title of the current page.
     *
     * @param title The title to set for the page.
     * @throws ScriptException If a page isn't being printed.
     */
    @ScriptFunction
    public final void setPageTitle(Optional<String> title) throws ScriptException {
        getCurrentPage();
        printer.setPageTitle(title.map(StringUtil::normaliseLabel).orElse(""));
    }

    /**
     * Returns the amount of ink left in the printer.
     *
     * @return The amount of ink available to print with.
     */
    @ScriptFunction
    public final int getInkLevel() {
        return printer.getInkLevel();
    }

    /**
     * Returns the amount of paper left in the printer.
     *
     * @return The amount of paper available to print with.
     */
    @ScriptFunction
    public final int getPaperLevel() {
        return printer.getPaperLevel();
    }

    @Override
    public boolean equals(@Nullable IPeripheral other) {
        return this == other || (other instanceof PrinterPeripheral otherPrinter && otherPrinter.printer == printer);
    }

    @Override
    public Object getTarget() {
        return printer;
    }

    private Terminal getCurrentPage() throws ScriptException {
        var currentPage = printer.getCurrentPage();
        if (currentPage == null) throw new ScriptException("Page not started");
        return currentPage;
    }
}
