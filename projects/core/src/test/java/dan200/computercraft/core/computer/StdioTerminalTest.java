// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.core.filesystem.MemoryMount;
import org.junit.jupiter.api.Test;

import java.util.List;

import static dan200.computercraft.core.computer.TerminalHarness.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * process.stdout / stderr / stdin on a real terminal (#34): wrapping, scrolling, escape sequences and colours on the
 * output side; cooked and raw mode, keypress events and pausing on the input side.
 */
class StdioTerminalTest {
    private static final String PRELUDE = """
        require('/rom/lib/internal/globals');
        var probe = require('probe');
        """;

    private static TerminalHarness boot(String script, int width, int height, boolean colour) {
        return TerminalHarness.boot(new MemoryMount(), PRELUDE + script + "\nprobe.record('ready');", width, height, colour);
    }

    private static TerminalHarness boot(String script) {
        return boot(script, 10, 5, true);
    }

    @Test
    void stdout_wraps_and_scrolls() {
        try (var h = boot("""
            process.stdout.write('0123456789ABC\\n');
            process.stdout.write('0123456789');
            process.stdout.write('\\nZ');
            process.stdout.write('\\nx\\ty');
            """)) {
            h.waitForProbe(1);
            assertEquals(List.of("0123456789", "ABC", "0123456789", "Z", "x       y"),
                List.of(h.line(0), h.line(1), h.line(2), h.line(3), h.line(4)),
                "a full row wraps only when more text follows; \\t goes to the next tab stop\n" + h.dump());
        }

        try (var h = boot("""
            for (var i = 1; i <= 7; i++) console.log('line ' + i);
            process.stdout.write('abc\\rX');
            """)) {
            h.waitForProbe(1);
            assertEquals("line 4", h.line(0), "scrolled up\n" + h.dump());
            assertEquals("line 7", h.line(3));
            assertEquals("Xbc", h.line(4), "\\r returns to the start of the row");
        }
    }

    @Test
    void stderr_is_red_and_ansi_colours_map_to_the_palette() {
        try (var h = boot("""
            console.error('err');
            console.log('out');
            process.stdout.write('\\x1b[31mR\\x1b[0mW\\x1b[92mL\\x1b[39mD\\n');
            process.stdout.write(require('util').styleText('blue', 'b') + 'w\\n');
            """, 20, 6, true)) {
            h.waitForProbe(1);
            assertEquals("err", h.line(0));
            assertEquals("eee", h.colours(0).substring(0, 3), "stderr is red");
            assertEquals("000", h.colours(1).substring(0, 3), "stdout is white, the colour was restored");
            assertEquals("RWLD", h.line(2));
            assertEquals("e050", h.colours(2).substring(0, 4), "31 = red, 0 = reset, 92 = lime, 39 = default");
            assertEquals("b0", h.colours(3).substring(0, 2), "34 = blue");
        }

        // Monochrome terminals ignore the colours.
        try (var h = boot("console.error('err'); process.stdout.write('\\x1b[31mR\\n');", 10, 5, false)) {
            h.waitForProbe(1);
            assertEquals("000", h.colours(0).substring(0, 3));
            assertEquals("0", h.colours(1).substring(0, 1));
        }
    }

    @Test
    void stdout_interprets_cursor_and_erase_sequences() {
        try (var h = boot("""
            process.stdout.write('aaaaaaaaaa\\nbbbbbbbbbb\\ncccccccccc');
            process.stdout.write('\\x1b[2;3HX');            // CUP: row 2, column 3
            process.stdout.write('\\x1b[1;5H\\x1b[0K');      // erase to the end of row 1
            process.stdout.write('\\x1b[3;5H\\x1b[1K');      // erase to the start of row 3
            process.stdout.cursorTo(0, 4);
            process.stdout.write('\\x1b[');                  // a sequence split across writes
            process.stdout.write('2CY');
            process.stdout.moveCursor(-1, -1);
            process.stdout.write('Q');
            """)) {
            h.waitForProbe(1);
            assertEquals("aaaa", h.line(0), h.dump());
            assertEquals("bbXbbbbbbb", h.line(1));
            assertEquals("     ccccc", h.line(2));
            assertEquals("  Q", h.line(3));
            assertEquals("  Y", h.line(4));
        }
    }

    @Test
    void stdin_cooked_mode_echoes_and_delivers_lines() {
        try (var h = boot("""
            process.stdin.on('data', function (d) { probe.record('data:' + d); });
            process.stdin.on('end', function () { probe.record('end'); });
            process.stdin.on('keypress', function (s, key) { if (key.name === 'backspace') probe.record('key:backspace'); });
            """, 20, 5, true)) {
            h.waitForProbe(1);
            h.type("hi");
            h.key(KEY_BACKSPACE);
            h.type("o");
            h.key(KEY_ENTER);
            h.waitForProbe(3);
            assertEquals(List.of("ready", "key:backspace", "data:ho\n"), h.probe());
            assertEquals("ho", h.line(0), "typed text is echoed\n" + h.dump());
            assertTrue(h.cursorBlink(), "the cursor blinks while stdin is read");

            h.paste("p1\np2");
            h.key(KEY_ENTER);
            h.waitForProbe(5);
            assertEquals(List.of("data:p1\n", "data:p2\n"), h.probe().subList(3, 5));

            h.ctrl('D');
            h.waitForProbe(6);
            assertEquals("end", h.probe().get(5));
        }
    }

    @Test
    void stdin_raw_mode_delivers_keys() {
        try (var h = boot("""
            process.stdin.setRawMode(true);
            process.stdin.on('data', function (d) { probe.record(JSON.stringify(d.replace(/\\x1b/g, '<ESC>'))); });
            process.stdin.on('keypress', function (s, key) {
                probe.record((key.ctrl ? 'C-' : '') + (key.shift ? 'S-' : '') + key.name);
            });
            """, 20, 5, true)) {
            h.waitForProbe(1);
            h.type("a");
            h.key(KEY_UP);
            h.ctrl('C');
            h.key(KEY_ENTER);
            h.waitForProbe(9);
            assertEquals(List.of("\"a\"", "a", "\"<ESC>[A\"", "up", "\"\\u0003\"", "C-c", "\"\\r\"", "return"),
                h.probe().subList(1, 9));
            assertEquals("", h.line(0), "raw mode does not echo");
        }
    }

    @Test
    void paused_stdin_drops_input() {
        try (var h = boot("""
            var onData = function (d) { probe.record(d); };
            process.stdin.on('data', onData);
            process.stdin.pause();
            require('events').on('key', function (key) {
                if (key === 265) { process.stdin.resume(); probe.record('resumed'); }
            });
            """, 20, 5, true)) {
            h.waitForProbe(1);
            h.type("lost");
            h.key(KEY_ENTER);
            h.key(KEY_UP);
            h.waitForProbe(2);
            h.type("kept");
            h.key(KEY_ENTER);
            h.waitForProbe(3);
            assertEquals(List.of("ready", "resumed", "kept\n"), h.probe());
            assertFalse(h.screen().contains("lost"), "nothing is echoed while paused\n" + h.dump());
        }
    }
}
