// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.filesystem.FileSystemException;
import dan200.computercraft.core.filesystem.FileSystemWrapper;
import org.jspecify.annotations.Nullable;
import org.mozilla.javascript.*;

import java.io.IOException;
import java.nio.channels.Channels;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Module-loader infrastructure for the JS machine, exposed as {@code __cc_loader__} on the global scope.
 *
 * <p>Module sources are compiled here into an (interpreted) wrapper function named after the module's path, so errors
 * and stack traces carry the real file name and line. The actual module execution is intentionally handled by the
 * JS-side {@code require()} function (defined in {@link JSMachine#REQUIRE_SETUP_JS}): calling the wrapper from JS
 * preserves Rhino's interpreter frame chain, which is required for {@link Context#captureContinuation()} to work
 * through {@code require()}'d module code.
 */
@SuppressWarnings("serial")
final class JSRequire extends ScriptableObject {

    private final @Nullable FileSystem fileSystem;
    private final Map<String, Object> nativeModules = new HashMap<>();
    // Resolved path -> module object ({ exports, id, filename }). The JS side calls setCache() *before* a module
    // executes, so circular requires find the partially-initialised module, and deleteCache() if it throws.
    private final Map<String, Scriptable> cache = new HashMap<>();

    JSRequire(Scriptable scope, @Nullable FileSystem fileSystem) {
        this.fileSystem = fileSystem;
        setParentScope(scope);
        setPrototype(ScriptableObject.getClassPrototype(scope, "Object"));
        ScriptableObject.putProperty(this, "lookup", new LookupFn());
        ScriptableObject.putProperty(this, "resolve", new ResolveFn());
        ScriptableObject.putProperty(this, "setCache", new SetCacheFn());
        ScriptableObject.putProperty(this, "deleteCache", new DeleteCacheFn());
    }

    void registerNative(String id, Object exports) {
        nativeModules.put(id, exports);
    }

    @Override
    public String getClassName() {
        return "JSRequire";
    }

    // --- path helpers -------------------------------------------------------

    /**
     * Node-style core modules implemented in the ROM (TypeScript under {@code /rom/lib}). Like Node's core modules they
     * resolve before {@code require.paths}, so they cannot be shadowed and do not depend on {@code PATH}; they can also
     * be required with a {@code node:} prefix ({@code require('node:util')}).
     */
    static final Set<String> ROM_CORE_MODULES = Set.of(
        "console", "process", "util", "readline", "readline/promises"
    );

    private static final String NODE_PREFIX = "node:";

    /** The absolute path of a ROM core module, or {@code null} if {@code id} does not name one. */
    static @Nullable String romCoreModule(String id) {
        var name = id.startsWith(NODE_PREFIX) ? id.substring(NODE_PREFIX.length()) : id;
        return ROM_CORE_MODULES.contains(name) ? "/rom/lib/" + name : null;
    }

    private String resolvePath(String id, String currentDir, @Nullable Object jsPaths) {
        var core = romCoreModule(id);
        if (core != null) return addJsExtension(normalize(core));

        if (id.startsWith("./") || id.startsWith("../")) {
            var base = currentDir.isEmpty() ? id : currentDir + "/" + id;
            return addJsExtension(normalize(base));
        }
        if (id.startsWith("/")) {
            return addJsExtension(normalize(id));
        }
        // Bare name: iterate require.paths forwarded from the JS side.
        if (jsPaths instanceof NativeArray arr) {
            var len = (int) arr.getLength();
            for (var i = 0; i < len; i++) {
                var dir = Context.toString(arr.get(i, arr));
                var candidate = addJsExtension(normalize(dir + "/" + id));
                if (existsQuietly(candidate)) return candidate;
            }
        }
        // Fallback: /rom/apis when paths is not yet set (e.g. during bios bootstrap).
        var candidate = addJsExtension(normalize("/rom/apis/" + id));
        if (existsQuietly(candidate)) return candidate;
        return addJsExtension(normalize(id));
    }

    private static String addJsExtension(String path) {
        return FileSystem.getName(path).contains(".") ? path : path + ".js";
    }

    private static String normalize(String path) {
        return FileSystem.sanitizePath(path, false);
    }

    private boolean existsQuietly(String path) {
        if (fileSystem == null) return false;
        try {
            return fileSystem.exists(path);
        } catch (FileSystemException ignored) {
            return false;
        }
    }

    /** A JS {@code Error} whose message is exactly {@code MODULE_NOT_FOUND: id} (no appended source position). */
    private static RuntimeException moduleNotFound(String id) {
        return ScriptRuntime.constructError("Error", "MODULE_NOT_FOUND: " + id);
    }

    private String loadSource(String id, String resolved) {
        if (fileSystem == null) throw moduleNotFound(id);
        try {
            if (!fileSystem.exists(resolved)) throw moduleNotFound(id);
            try (FileSystemWrapper<SeekableByteChannel> wrapper = fileSystem.openForRead(resolved)) {
                return new String(Channels.newInputStream(wrapper.get()).readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (FileSystemException | IOException e) {
            throw moduleNotFound(id);
        }
    }

    /**
     * Wrap a module's source in a {@code function (module, exports, require, __filename, __dirname)}. The header is
     * on the same line as the first source line, so line numbers in errors match the file.
     */
    private Function compileModule(Context cx, String source, String resolved) {
        var wrapped = "function (module, exports, require, __filename, __dirname) {" + source + "\n}";
        return cx.compileFunction(ScriptableObject.getTopLevelScope(this), wrapped, "/" + resolved, 1, null);
    }

    // --- JS-callable methods ------------------------------------------------

    private static @Nullable Object jsPaths(Object[] args) {
        return args.length > 2 ? args[2] : null;
    }

    private static String currentDir(Object[] args) {
        return args.length > 1 && !(args[1] instanceof Undefined) ? Context.toString(args[1]) : "";
    }

    /**
     * {@code loader.lookup(id, currentDir, paths, uncached)} — resolves a module without executing it.
     *
     * Returns:
     * <ul>
     *   <li>The exports object directly if the module is native, or cached and {@code uncached} is false.</li>
     *   <li>A load-spec object {@code {__CC_LOAD__:true, resolved, fn, dir}} if the module
     *       source was found on the filesystem and needs to be executed by the JS side.</li>
     * </ul>
     * Throws a JS error if the module cannot be found.
     */
    private final class LookupFn extends BaseFunction {
        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            var id = Context.toString(args[0]);

            var nat = nativeModules.get(id);
            if (nat != null) return nat;

            var resolved = resolvePath(id, currentDir(args), jsPaths(args));

            var uncached = args.length > 3 && Context.toBoolean(args[3]);
            if (!uncached) {
                var cached = cache.get(resolved);
                if (cached != null) return ScriptableObject.getProperty(cached, "exports");
            }

            var source = loadSource(id, resolved);
            var dir = FileSystem.getDirectory(resolved);

            var spec = cx.newObject(scope);
            ScriptableObject.putProperty(spec, "__CC_LOAD__", Boolean.TRUE);
            ScriptableObject.putProperty(spec, "resolved", resolved);
            ScriptableObject.putProperty(spec, "fn", compileModule(cx, source, resolved));
            ScriptableObject.putProperty(spec, "dir", dir.isEmpty() ? "/" : dir);
            return spec;
        }
    }

    /**
     * {@code loader.resolve(id, currentDir, paths)} — returns the absolute path a module id resolves to (or the id
     * itself for native modules) without executing it. Throws {@code MODULE_NOT_FOUND} if there is no such module.
     */
    private final class ResolveFn extends BaseFunction {
        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            var id = Context.toString(args[0]);
            if (nativeModules.containsKey(id)) return id;

            var resolved = resolvePath(id, currentDir(args), jsPaths(args));
            if (!cache.containsKey(resolved) && !existsQuietly(resolved)) {
                throw moduleNotFound(id);
            }
            return resolved;
        }
    }

    /** {@code loader.setCache(resolved, module)} — caches a module object before its body executes. */
    private final class SetCacheFn extends BaseFunction {
        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            if (!(args[1] instanceof Scriptable module)) throw Context.reportRuntimeError("module must be an object");
            cache.put(Context.toString(args[0]), module);
            return Undefined.instance;
        }
    }

    /** {@code loader.deleteCache(resolved)} — evicts a module whose body threw. */
    private final class DeleteCacheFn extends BaseFunction {
        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            cache.remove(Context.toString(args[0]));
            return Undefined.instance;
        }
    }
}
