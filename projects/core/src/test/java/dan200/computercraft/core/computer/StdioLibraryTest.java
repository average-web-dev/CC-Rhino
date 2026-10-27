// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * The Node-style ROM modules {@code util}, {@code console}, {@code process}, {@code readline} and
 * {@code readline/promises} (#34), exercised by the JS programs under {@code src/test/resources/stdio/} on a real
 * computer with the ROM mounted. Readline runs against fake streams, so line editing can be driven with VT input.
 */
class StdioLibraryTest {
    private static final int MAX_SECONDS = 20;

    private static String resource(String name) {
        try (var stream = StdioLibraryTest.class.getClassLoader().getResourceAsStream("stdio/" + name)) {
            return new String(Objects.requireNonNull(stream, name).readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void run(String name) {
        ComputerBootstrap.run(resource("prelude.js") + "\n" + resource(name), MAX_SECONDS);
    }

    @Test
    void util() {
        run("util.js");
    }

    @Test
    void console() {
        run("console.js");
    }

    @Test
    void process() {
        run("process.js");
    }

    @Test
    void readline() {
        run("readline.js");
    }
}
