// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.core.filesystem.MemoryMount;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * The Node-style ROM modules {@code util}, {@code console}, {@code process}, {@code readline},
 * {@code readline/promises} (#34), {@code timers} and {@code timers/promises} (#45), exercised by the TypeScript
 * programs under {@code src/test/ts/stdio/} on a real computer with the ROM mounted; also the shape of every ROM
 * module and the ES module interop (#49). Readline runs against fake streams, so line editing can be driven with VT
 * input.
 * <p>
 * The programs are compiled by {@code :core:transpileTestTypeScript} into the {@code ts-fixtures/stdio/} test
 * resources. Each one runs as {@code /test.js}, next to the shared helpers in {@code /prelude.js}.
 */
class StdioLibraryTest {
    private static final int MAX_SECONDS = 20;

    private static String resource(String name) {
        try (var stream = StdioLibraryTest.class.getClassLoader().getResourceAsStream("ts-fixtures/stdio/" + name)) {
            return new String(Objects.requireNonNull(stream, name).readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void run(String name, String... modules) {
        var mount = new MemoryMount()
            .addFile("prelude.js", resource("prelude.js"))
            .addFile("test.js", resource(name));
        for (var module : modules) mount.addFile(module, resource(module));
        ComputerBootstrap.run(mount, x -> {
        }, MAX_SECONDS);
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

    @Test
    void timers() {
        run("timers.js");
    }

    /** What plain-JS {@code require} sees of every ROM module (#49). */
    @Test
    void exports() {
        run("exports.js");
    }

    /** ES module imports (default, namespace, named) of native, ROM and compiled modules (#49). */
    @Test
    void interop() {
        run("interop.js", "interop-lib.js");
    }
}
