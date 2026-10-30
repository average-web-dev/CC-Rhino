// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import dan200.computercraft.core.terminal.Terminal;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * Renders the output of a {@link Tty} onto a {@link Terminal} grid (a computer screen or a monitor), like a VT100-style
 * terminal emulator.
 * <p>
 * Text wraps at the right edge (pending wrap: a full row only wraps when the next character arrives), scrolls at the
 * bottom and honours {@code \n} (new line, at column 0), {@code \r}, {@code \t} and {@code \b}. Escape sequences:
 * <ul>
 *   <li>SGR colours ({@code ESC [ … m}): 30–37/90–97 and 40–47/100–107 onto the 16 CC colours, 38/48;5;n for the first
 *   16 palette entries, 38/48;6;i for CC colour i (0–15, its blit digit; a CC extension, as the ANSI colours
 *   cannot name all 16 CC colours), 0/39/49 back to the stream's defaults. Everything else (bold, underline, RGB, …)
 *   is ignored;</li>
 *   <li>cursor movement and erasing: CUU/CUD/CUF/CUB ({@code A B C D}), CNL/CPL ({@code E F}), CHA ({@code G}),
 *   CUP ({@code H f}), ED ({@code J}), EL ({@code K}), SU/SD ({@code S T}), save/restore ({@code s u}, {@code ESC 7},
 *   {@code ESC 8}), full reset ({@code ESC c});</li>
 *   <li>DEC private modes ({@code ESC [ ? n h/l}): 25 (cursor blink), 1000/1002/1003 (mouse reporting) and 1006 (SGR
 *   mouse encoding), which {@link #mouseMode()} reports to the input side;</li>
 *   <li>the CC blit sequence {@code ESC P cc-blit ; <text colours> ; <background colours> ; <text> ESC \}: writes
 *   {@code text} at the cursor with one colour per character ({@code 0}–{@code f}, as {@code term.blit}), without
 *   wrapping, and moves the cursor behind it.</li>
 * </ul>
 * {@code stderr} is written in red. Escape sequences split across writes are completed by the next write of the same
 * stream.
 */
public final class TerminalEmulator {
    /** CC colour indices (blit digits): white = 0 … black = 15. */
    static final int WHITE = 0, ORANGE = 1, MAGENTA = 2, LIGHT_BLUE = 3, YELLOW = 4, LIME = 5, PINK = 6, GRAY = 7,
        LIGHT_GRAY = 8, CYAN = 9, PURPLE = 10, BLUE = 11, GREEN = 13, RED = 14, BLACK = 15;

    /** ANSI colour index (0–7 normal, 8–15 bright) → CC colour. */
    private static final int[] ANSI_COLOURS = {
        BLACK, RED, GREEN, ORANGE, BLUE, PURPLE, CYAN, LIGHT_GRAY,
        GRAY, PINK, LIME, YELLOW, LIGHT_BLUE, MAGENTA, CYAN, WHITE,
    };

    private static final int DEFAULT_FG = WHITE;
    private static final int DEFAULT_BG = BLACK;
    private static final int ERROR_FG = RED;
    private static final char ESC = 0x1b;
    private static final String BLIT_PREFIX = "cc-blit;";

    /** Which mouse events the program asked for ({@code ESC [ ? 1000/1002/1003 h}). */
    public enum MouseMode {
        /** No mouse reporting. */
        NONE,
        /** Presses and releases (1000). */
        CLICKS,
        /** Also motion while a button is held (1002). */
        DRAG,
        /** All motion (1003). */
        ANY,
    }

    private final Terminal terminal;
    private final Stream out = new Stream(DEFAULT_FG);
    private final Stream err = new Stream(ERROR_FG);

    private int savedX = -1;
    private int savedY = -1;
    private MouseMode mouseMode = MouseMode.NONE;
    private boolean sgrMouse;

    /** Per-stream state: the default text colour and any escape sequence split across writes. */
    private static final class Stream {
        final int defaultFg;
        String pending = "";

        Stream(int defaultFg) {
            this.defaultFg = defaultFg;
        }
    }

    public TerminalEmulator(Terminal terminal) {
        this.terminal = terminal;
    }

    public Terminal terminal() {
        return terminal;
    }

    /** Attach this emulator to a TTY: its {@code stdout} and {@code stderr} are rendered here. */
    public void attach(Tty tty) {
        tty.attach(this::writeOut, this::writeErr);
    }

    /** The mouse events the program asked for. */
    public synchronized MouseMode mouseMode() {
        return mouseMode;
    }

    /** Whether mouse events should use the SGR encoding ({@code ESC [ < … M/m}) rather than the X10 one. */
    public synchronized boolean sgrMouse() {
        return sgrMouse;
    }

    /** Render text written to {@code stdout}. */
    public synchronized void writeOut(String text) {
        write(text, out);
    }

    /** Render text written to {@code stderr}, in red. */
    public synchronized void writeErr(String text) {
        if (!terminal.isColour()) {
            write(text, err);
            return;
        }
        var previous = terminal.getTextColour();
        terminal.setTextColour(ERROR_FG);
        try {
            write(text, err);
        } finally {
            terminal.setTextColour(previous);
        }
    }

    private void write(String input, Stream stream) {
        var text = stream.pending.isEmpty() ? input : stream.pending + input;
        stream.pending = "";

        var run = new StringBuilder();
        var i = 0;
        while (i < text.length()) {
            var ch = text.charAt(i);
            if (ch >= 0x20 && ch != 0x7f) {
                run.append(ch);
                i++;
                continue;
            }

            if (!run.isEmpty()) {
                putText(run.toString());
                run.setLength(0);
            }

            switch (ch) {
                case '\n' -> {
                    newLine();
                    i++;
                }
                case '\r' -> {
                    terminal.setCursorPos(0, terminal.getCursorY());
                    i++;
                }
                case '\t' -> {
                    var x = terminal.getCursorX();
                    var width = terminal.getWidth();
                    if (x >= width) {
                        newLine();
                        x = 0;
                    }
                    putText(" ".repeat(Math.min(8 - (x % 8), width - x)));
                    i++;
                }
                case '\b' -> {
                    backspace();
                    i++;
                }
                case ESC -> {
                    var next = escape(text, i, stream);
                    if (next < 0) {
                        stream.pending = text.substring(i);
                        return;
                    }
                    i = next;
                }
                default -> i++; // Other C0 controls (bell, …) have no visible effect.
            }
        }
        if (!run.isEmpty()) putText(run.toString());
    }

    /**
     * Handle the escape sequence starting at {@code text[start]} (an ESC).
     *
     * @return The index after the sequence, or {@code -1} if it is incomplete.
     */
    private int escape(String text, int start, Stream stream) {
        if (start + 1 >= text.length()) return -1;
        var next = text.charAt(start + 1);
        switch (next) {
            case '[' -> {
                var end = start + 2;
                while (end < text.length() && isCsiParameter(text.charAt(end))) end++;
                if (end >= text.length()) return -1;
                csi(text.substring(start + 2, end), text.charAt(end), stream);
                return end + 1;
            }
            case 'P' -> {
                var end = text.indexOf(ESC + "\\", start + 2);
                if (end < 0) return -1;
                dcs(text.substring(start + 2, end));
                return end + 2;
            }
            case '7' -> {
                saveCursor();
                return start + 2;
            }
            case '8' -> {
                restoreCursor();
                return start + 2;
            }
            case 'c' -> {
                reset(stream);
                return start + 2;
            }
            default -> {
                return start + 2; // other two-character escapes: ignored
            }
        }
    }

    private static boolean isCsiParameter(char ch) {
        return (ch >= '0' && ch <= '9') || ch == ';' || ch == '?' || ch == '<';
    }

    // ── Printing ─────────────────────────────────────────────────────────────────

    /** Move to the start of the next row, scrolling when the cursor is on the last one. */
    private void newLine() {
        var y = terminal.getCursorY();
        var height = terminal.getHeight();
        if (y + 1 >= height) {
            terminal.scroll(1);
            terminal.setCursorPos(0, height - 1);
        } else {
            terminal.setCursorPos(0, y + 1);
        }
    }

    /** Write printable text at the cursor, wrapping at the right edge. */
    private void putText(String text) {
        var width = terminal.getWidth();
        while (!text.isEmpty()) {
            var room = width - terminal.getCursorX();
            if (room <= 0) { // pending wrap: the row is full
                newLine();
                continue;
            }
            if (text.length() <= room) {
                writeAtCursor(text);
                return;
            }
            writeAtCursor(text.substring(0, room));
            text = text.substring(room);
            newLine();
        }
    }

    private void writeAtCursor(String text) {
        terminal.write(text);
        terminal.setCursorPos(terminal.getCursorX() + text.length(), terminal.getCursorY());
    }

    /** {@code \b}: one column left; at the start of a row, to the end of the previous one (as the line editor expects). */
    private void backspace() {
        var x = Math.min(terminal.getCursorX(), terminal.getWidth());
        var y = terminal.getCursorY();
        if (x > 0) {
            terminal.setCursorPos(x - 1, y);
        } else if (y > 0) {
            terminal.setCursorPos(terminal.getWidth() - 1, y - 1);
        }
    }

    /** Overwrite {@code count} cells from (x, y) with spaces in the current background, keeping the cursor. */
    private void blank(int x, int y, int count) {
        if (count <= 0) return;
        var cx = terminal.getCursorX();
        var cy = terminal.getCursorY();
        terminal.setCursorPos(x, y);
        terminal.write(" ".repeat(count));
        terminal.setCursorPos(cx, cy);
    }

    private void saveCursor() {
        savedX = terminal.getCursorX();
        savedY = terminal.getCursorY();
    }

    private void restoreCursor() {
        if (savedY >= 0) terminal.setCursorPos(savedX, savedY);
    }

    private void reset(Stream stream) {
        setFg(stream.defaultFg);
        setBg(DEFAULT_BG);
        terminal.clear();
        terminal.setCursorPos(0, 0);
        mouseMode = MouseMode.NONE;
        sgrMouse = false;
    }

    // ── Colours ──────────────────────────────────────────────────────────────────

    private void setFg(int colour) {
        if (terminal.isColour()) terminal.setTextColour(colour);
    }

    private void setBg(int colour) {
        if (terminal.isColour()) terminal.setBackgroundColour(colour);
    }

    /** Apply an SGR ({@code ESC [ … m}) parameter list. */
    private void sgr(int[] params, Stream stream) {
        if (params.length == 0) params = new int[]{ 0 };
        for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p == 0) {
                setFg(stream.defaultFg);
                setBg(DEFAULT_BG);
            } else if (p >= 30 && p <= 37) {
                setFg(ANSI_COLOURS[p - 30]);
            } else if (p >= 90 && p <= 97) {
                setFg(ANSI_COLOURS[p - 90 + 8]);
            } else if (p == 39) {
                setFg(stream.defaultFg);
            } else if (p >= 40 && p <= 47) {
                setBg(ANSI_COLOURS[p - 40]);
            } else if (p >= 100 && p <= 107) {
                setBg(ANSI_COLOURS[p - 100 + 8]);
            } else if (p == 49) {
                setBg(DEFAULT_BG);
            } else if (p == 38 || p == 48) {
                // Extended colours: 5;n (256-colour palette, only its first 16 entries map onto CC colours) or 2;r;g;b.
                var mode = i + 1 < params.length ? params[i + 1] : -1;
                if (mode == 5) {
                    if (i + 2 < params.length && params[i + 2] >= 0 && params[i + 2] < 16) {
                        if (p == 38) setFg(ANSI_COLOURS[params[i + 2]]); else setBg(ANSI_COLOURS[params[i + 2]]);
                    }
                    i += 2;
                } else if (mode == 2) {
                    i += 4;
                } else if (mode == 6) {
                    // CC extension: 6;i selects CC colour i (its blit digit, 0 = white … 15 = black) directly.
                    if (i + 2 < params.length && params[i + 2] >= 0 && params[i + 2] < 16) {
                        if (p == 38) setFg(params[i + 2]); else setBg(params[i + 2]);
                    }
                    i += 2;
                }
            }
            // Everything else (bold, italic, underline, inverse, …) has no equivalent on a CC terminal.
        }
    }

    // ── Control sequences ────────────────────────────────────────────────────────

    /** Execute a CSI sequence with the given parameters and final character. */
    private void csi(String paramText, char finalChar, Stream stream) {
        var priv = paramText.startsWith("?");
        if (paramText.startsWith("<")) return; // SGR mouse reports belong to input, not output
        var params = parseParams(priv ? paramText.substring(1) : paramText);
        var n = params.length == 0 || params[0] == 0 ? 1 : params[0];

        if (priv) {
            privateMode(params, finalChar == 'h');
            return;
        }

        var width = terminal.getWidth();
        var height = terminal.getHeight();
        var y = terminal.getCursorY();
        // A cursor in the pending-wrap position (x == width) counts as being on the last column.
        var x = Math.min(terminal.getCursorX(), width - 1);
        switch (finalChar) {
            case 'm' -> sgr(params, stream);
            case 'A' -> terminal.setCursorPos(x, clamp(y - n, 0, height - 1));
            case 'B' -> terminal.setCursorPos(x, clamp(y + n, 0, height - 1));
            case 'C' -> terminal.setCursorPos(clamp(x + n, 0, width - 1), y);
            case 'D' -> terminal.setCursorPos(clamp(x - n, 0, width - 1), y);
            case 'E' -> terminal.setCursorPos(0, clamp(y + n, 0, height - 1));
            case 'F' -> terminal.setCursorPos(0, clamp(y - n, 0, height - 1));
            case 'G' -> terminal.setCursorPos(clamp(n - 1, 0, width - 1), y);
            case 'H', 'f' -> {
                var row = params.length < 1 || params[0] == 0 ? 1 : params[0];
                var col = params.length < 2 || params[1] == 0 ? 1 : params[1];
                terminal.setCursorPos(clamp(col - 1, 0, width - 1), clamp(row - 1, 0, height - 1));
            }
            case 'J' -> {
                var mode = params.length == 0 ? 0 : params[0];
                if (mode == 2 || mode == 3) {
                    terminal.clear();
                } else if (mode == 0) {
                    blank(x, y, width - x);
                    for (var row = y + 1; row < height; row++) blank(0, row, width);
                } else {
                    for (var row = 0; row < y; row++) blank(0, row, width);
                    blank(0, y, x + 1);
                }
            }
            case 'K' -> {
                var mode = params.length == 0 ? 0 : params[0];
                if (mode == 0) {
                    blank(x, y, width - x);
                } else if (mode == 1) {
                    blank(0, y, x + 1);
                } else {
                    blank(0, y, width);
                }
            }
            case 'S' -> terminal.scroll(n);
            case 'T' -> terminal.scroll(-n);
            case 's' -> saveCursor();
            case 'u' -> restoreCursor();
            default -> {
                // Any other sequence is consumed without effect.
            }
        }
    }

    private void privateMode(int[] params, boolean set) {
        for (var param : params) {
            switch (param) {
                case 25 -> terminal.setCursorBlink(set);
                case 1000 -> mouseMode = set ? MouseMode.CLICKS : MouseMode.NONE;
                case 1002 -> mouseMode = set ? MouseMode.DRAG : MouseMode.NONE;
                case 1003 -> mouseMode = set ? MouseMode.ANY : MouseMode.NONE;
                case 1006 -> sgrMouse = set;
                default -> {
                }
            }
        }
    }

    /** {@code ESC P … ESC \}: only the CC blit sequence is understood. */
    private void dcs(String body) {
        if (!body.startsWith(BLIT_PREFIX)) return;
        var fgEnd = body.indexOf(';', BLIT_PREFIX.length());
        if (fgEnd < 0) return;
        var bgEnd = body.indexOf(';', fgEnd + 1);
        if (bgEnd < 0) return;

        var fg = body.substring(BLIT_PREFIX.length(), fgEnd);
        var bg = body.substring(fgEnd + 1, bgEnd);
        var text = body.substring(bgEnd + 1);
        if (fg.length() != text.length() || bg.length() != text.length()) return;

        var x = Math.min(terminal.getCursorX(), terminal.getWidth());
        terminal.setCursorPos(x, terminal.getCursorY());
        terminal.blit(latin1(text), latin1(fg.toLowerCase()), latin1(bg.toLowerCase()));
        terminal.setCursorPos(x + text.length(), terminal.getCursorY());
    }

    private static ByteBuffer latin1(String text) {
        return ByteBuffer.wrap(text.getBytes(StandardCharsets.ISO_8859_1));
    }

    private static int[] parseParams(String text) {
        if (text.isEmpty()) return new int[0];
        var parts = text.split(";", -1);
        var out = new int[parts.length];
        var count = 0;
        for (var part : parts) {
            if (part.isEmpty()) continue;
            try {
                out[count++] = Integer.parseInt(part);
            } catch (NumberFormatException e) {
                out[count++] = 0;
            }
        }
        return count == out.length ? out : java.util.Arrays.copyOf(out, count);
    }

    private static int clamp(int value, int min, int max) {
        return value < min ? min : Math.min(value, max);
    }
}
