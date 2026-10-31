// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.tty;

import java.util.function.Consumer;

/**
 * The input processing of a {@link Tty}, between what is typed (or written to its {@code stdin}) and what a program
 * reads.
 * <p>
 * In <em>raw</em> mode input passes through unchanged. In <em>cooked</em> mode (the default, as on Unix) the line
 * discipline echoes what is typed, lets the line be edited and hands out complete lines only:
 * <ul>
 *   <li>Enter ({@code \r} or {@code \n}): deliver the line with a trailing {@code \n};</li>
 *   <li>Backspace ({@code \x7f} or {@code \b}): erase the last character;</li>
 *   <li>Ctrl+U: erase the line;</li>
 *   <li>Ctrl+D: on an empty line, end of input (read once); otherwise deliver the line as it is;</li>
 *   <li>Ctrl+C: discard the line and report an interrupt;</li>
 *   <li>other control characters and escape sequences (cursor keys, function keys) are ignored.</li>
 * </ul>
 * Not thread-safe: the owning {@link Tty} serialises input.
 */
final class LineDiscipline {
    private static final char ESC = 0x1b;

    private final Pipe input;
    private final Consumer<String> echo;
    private final Runnable interrupt;

    private final StringBuilder line = new StringBuilder();
    private boolean raw;
    private EscapeState escape = EscapeState.NONE;
    private boolean lastWasCr;

    private enum EscapeState {
        NONE,
        /** After ESC. */
        START,
        /** Inside {@code ESC [ …} or {@code ESC O …}, until the final byte. */
        SEQUENCE,
    }

    /**
     * @param input     The pipe programs read from.
     * @param echo      Receives the echo of cooked input (written to the TTY's output).
     * @param interrupt Called for Ctrl+C in cooked mode.
     */
    LineDiscipline(Pipe input, Consumer<String> echo, Runnable interrupt) {
        this.input = input;
        this.echo = echo;
        this.interrupt = interrupt;
    }

    boolean isRaw() {
        return raw;
    }

    /** Switch between raw and cooked mode; a half-typed line is dropped. */
    void setRaw(boolean raw) {
        if (this.raw == raw) return;
        this.raw = raw;
        line.setLength(0);
        escape = EscapeState.NONE;
        lastWasCr = false;
    }

    /** The cooked line typed so far (not yet delivered). */
    String pendingLine() {
        return line.toString();
    }

    void input(String data) {
        if (raw) {
            input.write(data);
            return;
        }

        var out = new StringBuilder();
        for (var i = 0; i < data.length(); i++) cooked(data.charAt(i), out);
        if (!out.isEmpty()) echo.accept(out.toString());
    }

    private void cooked(char ch, StringBuilder out) {
        switch (escape) {
            case START -> {
                escape = ch == '[' || ch == 'O' ? EscapeState.SEQUENCE : EscapeState.NONE;
                return;
            }
            case SEQUENCE -> {
                if (ch >= 0x40 && ch <= 0x7e) escape = EscapeState.NONE;
                return;
            }
            case NONE -> {
            }
        }

        var wasCr = lastWasCr;
        lastWasCr = ch == '\r';
        switch (ch) {
            case '\n' -> {
                if (!wasCr) enter(out);
            }
            case '\r' -> enter(out);
            case 0x7f, '\b' -> erase(out);
            case 0x15 -> { // Ctrl+U
                while (!line.isEmpty()) erase(out);
            }
            case 0x04 -> { // Ctrl+D
                flush(out);
                if (line.isEmpty()) {
                    input.writeEof();
                } else {
                    deliver(line.toString());
                    line.setLength(0);
                }
            }
            case 0x03 -> { // Ctrl+C
                line.setLength(0);
                out.append("^C\n");
                flush(out);
                interrupt.run();
            }
            case ESC -> escape = EscapeState.START;
            default -> {
                if (ch < 0x20 && ch != '\t') return;
                line.append(ch);
                out.append(ch);
            }
        }
    }

    private void enter(StringBuilder out) {
        out.append('\n');
        flush(out);
        line.append('\n');
        deliver(line.toString());
        line.setLength(0);
    }

    private void erase(StringBuilder out) {
        if (line.isEmpty()) return;
        line.setLength(line.length() - 1);
        out.append("\b \b");
    }

    /** Echo what is pending before the input it belongs to becomes readable. */
    private void flush(StringBuilder out) {
        if (out.isEmpty()) return;
        echo.accept(out.toString());
        out.setLength(0);
    }

    private void deliver(String text) {
        input.write(text);
    }
}
