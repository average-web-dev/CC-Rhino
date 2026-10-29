// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Script;
import org.mozilla.javascript.Scriptable;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * The native {@code babel-helpers} module: Babel's runtime helpers ({@code classCallCheck}, {@code callSuper},
 * {@code toConsumableArray}, …), which code compiled with {@code babel-preset-rhino} imports instead of inlining them
 * ({@code var _babelHelpers = require("babel-helpers")}), as tsc's output imports {@code tslib}.
 *
 * <p>The module's source is generated at build time from {@code @babel/helpers}
 * ({@code src/build/babel-preset-rhino/build-helpers.mjs}), so it matches the Babel version the ROM was compiled
 * with. It is compiled once per JVM and evaluated per machine on the first {@code require}, so computers whose code
 * uses no helpers do not pay for it.
 */
final class JSBabelHelpers {
    static final String MODULE = "babel-helpers";
    private static final String RESOURCE = "babel-helpers.js";

    private static @Nullable Script script;

    private JSBabelHelpers() {
    }

    /** Create the module's exports in {@code scope}. */
    static Object create(Context cx, Scriptable scope) {
        return script(cx).exec(cx, scope, scope);
    }

    private static synchronized Script script(Context cx) {
        var script = JSBabelHelpers.script;
        if (script != null) return script;

        String source;
        try (var stream = JSBabelHelpers.class.getResourceAsStream(RESOURCE)) {
            source = new String(Objects.requireNonNull(stream, "Missing resource " + RESOURCE).readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        // An interpreted script holds no machine state, so all machines can share it.
        return JSBabelHelpers.script = cx.compileString(source, MODULE + ".js", 1, null);
    }
}
