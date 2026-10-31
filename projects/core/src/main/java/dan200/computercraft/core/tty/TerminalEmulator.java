// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import dan200.computercraft.core.terminal.Terminal;
import org.jspecify.annotations.Nullable;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.function.Consumer;

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
 *   mouse encoding), which {@link #mouseMode()} reports to the input side (and {@link Terminal#getMouseReporting()} to
 *   the client), and 2004 (bracketed paste, {@link #bracketedPaste()});</li>
 *   <li>the kitty keyboard protocol's flags ({@code CSI > flags u} push, {@code CSI < n u} pop, {@code CSI = flags ;
 *   mode u} change, {@code CSI ? u} query, answered in the TTY's input), which {@link #keyboardFlags()} reports to the
 *   input side (see {@link InputEncoder});</li>
 *   <li>the palette, as in xterm: OSC 4 ({@code ESC ] 4 ; i ; spec ST}, several {@code i ; spec} pairs allowed)
 *   sets the colour that ANSI colour {@code i} (0–15) shows, {@code spec} being {@code rgb:r/g/b} (1–4 hex digits per
 *   channel) or {@code #rgb} … {@code #rrrrggggbbbb}; OSC 104 ({@code ESC ] 104 [; i …] ST}) resets the given
 *   entries, or all. Each console keeps its own palette, {@code ESC c} resets it. Other OSC sequences are ignored; ST
 *   is {@code ESC \} or BEL;</li>
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
        LIGHT_GRAY = 8, CYAN = 9, PURPLE = 10, BLUE = 11, BROWN = 12, GREEN = 13, RED = 14, BLACK = 15;

    /**
     * ANSI colour index (0–7 normal, 8–15 bright) → CC colour (blit digit), one CC colour per index: the assignment
     * closest to the Linux console's colours (VGA) by CIEDE2000 over all sixteen. So yellow is brown (as on VGA),
     * bright red is pink and bright cyan is orange, which CC has no closer colour for by default (programs can change
     * what an index shows with OSC 4). The ANSI index is the CC colour's palette index: blit digit d = ANSI index
     * 15 - d.
     */
    static final int[] ANSI_COLOURS = {
        BLACK, RED, GREEN, BROWN, BLUE, PURPLE, CYAN, LIGHT_GRAY,
        GRAY, PINK, LIME, YELLOW, LIGHT_BLUE, MAGENTA, ORANGE, WHITE,
    };

    private static final int DEFAULT_FG = WHITE;
    private static final int DEFAULT_BG = BLACK;
    private static final int ERROR_FG = RED;
    private static final char ESC = 0x1b;
    private static final char BEL = 0x07;
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
    private boolean bracketedPaste;
    /** The kitty keyboard flags pushed by programs; the top one applies. */
    private final ArrayDeque<Integer> keyboardFlags = new ArrayDeque<>();
    /** Answers to queries, sent to {@link #replyTo} once the output is rendered. */
    private final StringBuilder replies = new StringBuilder();
    private @Nullable Consumer<String> replyTo;

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

    /** Attach this emulator to a TTY: its {@code stdout} and {@code stderr} are rendered here, answers go to its input. */
    public void attach(Tty tty) {
        setReplyTo(tty::input);
        tty.attach(this::writeOut, this::writeErr);
    }

    /** Where answers to queries in the output go: the input of the TTY this emulator shows. */
    public synchronized void setReplyTo(@Nullable Consumer<String> replyTo) {
        this.replyTo = replyTo;
    }

    /** The kitty keyboard flags the program asked for (see {@link InputEncoder}), 0 for the legacy encoding. */
    public synchronized int keyboardFlags() {
        var flags = keyboardFlags.peek();
        return flags == null ? 0 : flags;
    }

    /** The mouse events the program asked for. */
    public synchronized MouseMode mouseMode() {
        return mouseMode;
    }

    /** Whether mouse events should use the SGR encoding ({@code ESC [ < … M/m}) rather than the X10 one. */
    public synchronized boolean sgrMouse() {
        return sgrMouse;
    }

    /** Whether pasted text should be wrapped in {@code ESC [ 200 ~} … {@code ESC [ 201 ~} (the program asked for it). */
    public synchronized boolean bracketedPaste() {
        return bracketedPaste;
    }

    /**
     * The colour ANSI colour {@code index} (0–15) shows now.
     *
     * @param index The ANSI colour index.
     * @return The colour as {@code 0xRRGGBB}.
     */
    public int paletteColour(int index) {
        synchronized (terminal) {
            var rgb = terminal.getPalette().getColour(paletteIndex(index));
            return channel(rgb[0]) << 16 | channel(rgb[1]) << 8 | channel(rgb[2]);
        }
    }

    private static int channel(double value) {
        return clamp((int) Math.round(value * 255), 0, 255);
    }

    /** Render text written to {@code stdout}. */
    public void writeOut(String text) {
        synchronized (this) {
            write(text, out);
        }
        sendReplies();
    }

    /** Render text written to {@code stderr}, in red. */
    public void writeErr(String text) {
        synchronized (this) {
            if (!terminal.isColour()) {
                write(text, err);
            } else {
                var previous = terminal.getTextColour();
                terminal.setTextColour(ERROR_FG);
                try {
                    write(text, err);
                } finally {
                    terminal.setTextColour(previous);
                }
            }
        }
        sendReplies();
    }

    /** Send the answers to queries, outside this emulator's lock (the TTY's input may echo into it). */
    private void sendReplies() {
        String reply;
        Consumer<String> target;
        synchronized (this) {
            if (replies.isEmpty()) return;
            reply = replies.toString();
            replies.setLength(0);
            target = replyTo;
        }
        if (target != null) target.accept(reply);
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
            case ']' -> {
                for (var i = start + 2; i < text.length(); i++) {
                    var ch = text.charAt(i);
                    if (ch == BEL) {
                        osc(text.substring(start + 2, i));
                        return i + 1;
                    }
                    if (ch == ESC) {
                        if (i + 1 >= text.length()) return -1;
                        osc(text.substring(start + 2, i));
                        // ST (ESC \) ends the sequence; another escape ends it too and is handled on its own.
                        return text.charAt(i + 1) == '\\' ? i + 2 : i;
                    }
                }
                return -1;
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

    /** The parameter bytes of ECMA-48 (0x30–0x3F): digits and {@code : ; < = > ?}. */
    private static boolean isCsiParameter(char ch) {
        return ch >= '0' && ch <= '?';
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
        setMouseMode(MouseMode.NONE);
        sgrMouse = false;
        bracketedPaste = false;
        keyboardFlags.clear();
        resetPalette(-1);
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
        if (finalChar == 'u' && !paramText.isEmpty() && "<>=?".indexOf(paramText.charAt(0)) >= 0) {
            keyboard(paramText.charAt(0), parseParams(paramText.substring(1)));
            return;
        }
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

    /** The kitty keyboard protocol's flag stack (at most 16 entries; pushing more drops the oldest). */
    private void keyboard(char kind, int[] params) {
        var first = params.length > 0 ? params[0] : 0;
        switch (kind) {
            case '>' -> {
                if (keyboardFlags.size() >= 16) keyboardFlags.removeLast();
                keyboardFlags.push(first & InputEncoder.ALL_FLAGS);
            }
            case '<' -> {
                for (var i = Math.max(first, 1); i > 0 && !keyboardFlags.isEmpty(); i--) keyboardFlags.pop();
            }
            case '=' -> {
                var flags = first & InputEncoder.ALL_FLAGS;
                var current = keyboardFlags.isEmpty() ? 0 : keyboardFlags.pop();
                var mode = params.length > 1 ? params[1] : 1;
                keyboardFlags.push(switch (mode) {
                    case 2 -> current | flags;
                    case 3 -> current & ~flags;
                    default -> flags;
                });
            }
            default -> replies.append("\u001b[?").append(keyboardFlags()).append('u');
        }
    }

    private void privateMode(int[] params, boolean set) {
        for (var param : params) {
            switch (param) {
                case 25 -> terminal.setCursorBlink(set);
                case 1000 -> setMouseMode(set ? MouseMode.CLICKS : MouseMode.NONE);
                case 1002 -> setMouseMode(set ? MouseMode.DRAG : MouseMode.NONE);
                case 1003 -> setMouseMode(set ? MouseMode.ANY : MouseMode.NONE);
                case 1006 -> sgrMouse = set;
                case 2004 -> bracketedPaste = set;
                default -> {
                }
            }
        }
    }

    private void setMouseMode(MouseMode mode) {
        mouseMode = mode;
        terminal.setMouseReporting(mode != MouseMode.NONE);
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

    // ── Palette ──────────────────────────────────────────────────────────────────

    /** {@code ESC ] … ST}: OSC 4 sets palette entries, OSC 104 resets them; other commands are ignored. */
    private void osc(String body) {
        var parts = body.split(";", -1);
        switch (parts[0]) {
            case "4" -> {
                for (var i = 1; i + 1 < parts.length; i += 2) {
                    var index = ansiIndex(parts[i]);
                    var rgb = parseColour(parts[i + 1]);
                    if (index >= 0 && rgb >= 0) setPaletteColour(index, rgb);
                }
            }
            case "104" -> {
                if (parts.length == 1 || (parts.length == 2 && parts[1].isEmpty())) {
                    resetPalette(-1);
                } else {
                    for (var i = 1; i < parts.length; i++) {
                        var index = ansiIndex(parts[i]);
                        if (index >= 0) resetPalette(index);
                    }
                }
            }
            default -> {
            }
        }
    }

    /**
     * The {@link dan200.computercraft.core.terminal.Palette} entry of ANSI colour {@code index}: the palette is ordered
     * by 15 minus the blit digit (as the renderer reads it), which is the ANSI index itself.
     */
    private static int paletteIndex(int index) {
        return 15 - ANSI_COLOURS[index];
    }

    /** An ANSI colour index 0–15, or -1. */
    private static int ansiIndex(String text) {
        try {
            var index = Integer.parseInt(text);
            return index >= 0 && index < ANSI_COLOURS.length ? index : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /**
     * An X11 colour spec, {@code rgb:r/g/b} or {@code #rgb} (1–4 hex digits per channel), as {@code 0xRRGGBB}.
     *
     * @return The colour, or -1 if the spec is invalid.
     */
    private static int parseColour(String spec) {
        String[] channels;
        if (spec.startsWith("rgb:")) {
            channels = spec.substring(4).split("/", -1);
            if (channels.length != 3) return -1;
        } else if (spec.startsWith("#") && (spec.length() - 1) % 3 == 0) {
            var n = (spec.length() - 1) / 3;
            channels = new String[]{
                spec.substring(1, 1 + n), spec.substring(1 + n, 1 + 2 * n), spec.substring(1 + 2 * n),
            };
        } else {
            return -1;
        }
        var rgb = 0;
        for (var channel : channels) {
            if (channel.isEmpty() || channel.length() > 4) return -1;
            int value;
            try {
                value = Integer.parseInt(channel, 16);
            } catch (NumberFormatException e) {
                return -1;
            }
            var max = (1 << (4 * channel.length())) - 1;
            rgb = rgb << 8 | Math.round(value * 255f / max);
        }
        return rgb;
    }

    private void setPaletteColour(int index, int rgb) {
        synchronized (terminal) {
            terminal.getPalette().setColour(paletteIndex(index),
                ((rgb >> 16) & 0xFF) / 255.0, ((rgb >> 8) & 0xFF) / 255.0, (rgb & 0xFF) / 255.0);
        }
        terminal.setChanged();
    }

    /** Reset palette entry {@code index} (an ANSI index), or all of them for -1. */
    private void resetPalette(int index) {
        synchronized (terminal) {
            var palette = terminal.getPalette();
            if (index < 0) palette.resetColours(); else palette.resetColour(paletteIndex(index));
        }
        terminal.setChanged();
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
