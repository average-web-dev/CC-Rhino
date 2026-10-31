// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.apis.tty;

import dan200.computercraft.core.computer.ComputerBootstrap;
import org.junit.jupiter.api.Test;

import static java.time.Duration.ofSeconds;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

/** The {@code screen} module on a real (advanced, as the bootstrap terminal has colour) computer. */
class ScreenAPITest {
    @Test
    void consoles() {
        assertTimeoutPreemptively(ofSeconds(30), () -> ComputerBootstrap.run("""
            var screen = require('screen');
            assert(screen.isActive(), 'the ROM (process, loaded by the bios) has taken over the screen');
            assert(screen.isColor(), 'colour terminal');
            assert(screen.getConsoleCount() === 4, 'advanced computers have 4 consoles by default');

            var consoles = screen.getConsoles();
            assert(consoles.length === 4, 'list');
            assert(consoles[0].getId() === screen.getConsole(0).getId(), 'same TTY');
            assert(!consoles[0].isResizable(), 'the size is set by the screen');
            assert(consoles[0].getSize().columns === 51 && consoles[0].getSize().rows === 19, 'screen size');

            screen.show(2);
            assert(screen.getVisible() === 2, 'visible');

            var threw = false;
            try { screen.show(4); } catch (e) { threw = true; }
            assert(threw, 'no such console');
            threw = false;
            try { consoles[0].setSize(10, 10); } catch (e) { threw = true; }
            assert(threw, 'console size is fixed');
            """, 20));
    }
}
