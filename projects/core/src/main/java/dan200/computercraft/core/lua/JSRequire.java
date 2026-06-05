// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.lua;

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

/**
 * Module-loader infrastructure for the JS machine, exposed as {@code __cc_loader__} on the global scope.
 *
 * <p>The actual module execution is intentionally handled by the JS-side {@code require()} function
 * (defined in {@link JSMachine#REQUIRE_SETUP_JS}) via {@code new Function()}.  Keeping execution on
 * the JS side preserves Rhino's interpreter frame chain, which is required for
 * {@link Context#captureContinuation()} to work through {@code require()}'d module code.
 */
@SuppressWarnings("serial")
final class JSRequire extends ScriptableObject {

    private final @Nullable FileSystem fileSystem;
    private final Map<String, Object> nativeModules = new HashMap<>();
    // Cache is stored here; the JS side calls setCache() after a module executes.
    private final Map<String, Object> cache = new HashMap<>();

    JSRequire(Scriptable scope, @Nullable FileSystem fileSystem) {
        this.fileSystem = fileSystem;
        setParentScope(scope);
        setPrototype(ScriptableObject.getClassPrototype(scope, "Object"));
        ScriptableObject.putProperty(this, "lookup", new LookupFn());
        ScriptableObject.putProperty(this, "setCache", new SetCacheFn());
    }

    void registerNative(String id, Object exports) {
        nativeModules.put(id, exports);
    }

    @Override
    public String getClassName() {
        return "JSRequire";
    }

    // --- path helpers -------------------------------------------------------

    private String resolvePath(String id, String currentDir) {
        if (id.startsWith("./") || id.startsWith("../")) {
            var base = currentDir.isEmpty() ? id : currentDir + "/" + id;
            return addJsExtension(normalize(base));
        }
        if (id.startsWith("/")) {
            return addJsExtension(normalize(id));
        }
        // Bare name: search /rom/apis
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

    private String loadSource(String id, String resolved) {
        if (fileSystem == null) throw Context.reportRuntimeError("MODULE_NOT_FOUND: " + id);
        try {
            if (!fileSystem.exists(resolved)) throw Context.reportRuntimeError("MODULE_NOT_FOUND: " + id);
            try (FileSystemWrapper<SeekableByteChannel> wrapper = fileSystem.openForRead(resolved)) {
                return new String(Channels.newInputStream(wrapper.get()).readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (FileSystemException | IOException e) {
            throw Context.reportRuntimeError("MODULE_NOT_FOUND: " + id);
        }
    }

    // --- JS-callable methods ------------------------------------------------

    /**
     * {@code loader.lookup(id, currentDir)} — resolves a module without executing it.
     *
     * Returns:
     * <ul>
     *   <li>The exports object directly if the module is native or cached.</li>
     *   <li>A load-spec object {@code {__CC_LOAD__:true, resolved, source, dir}} if the module
     *       source was found on the filesystem and needs to be executed by the JS side.</li>
     * </ul>
     * Throws a JS error if the module cannot be found.
     */
    private final class LookupFn extends BaseFunction {
        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            var id = Context.toString(args[0]);
            var currentDir = args.length > 1 && !(args[1] instanceof Undefined) ? Context.toString(args[1]) : "";

            var nat = nativeModules.get(id);
            if (nat != null) return nat;

            var resolved = resolvePath(id, currentDir);

            var cached = cache.get(resolved);
            if (cached != null) return cached;

            var source = loadSource(id, resolved);
            var dir = FileSystem.getDirectory(resolved);

            var spec = cx.newObject(scope);
            ScriptableObject.putProperty(spec, "__CC_LOAD__", Boolean.TRUE);
            ScriptableObject.putProperty(spec, "resolved", resolved);
            ScriptableObject.putProperty(spec, "source", source);
            ScriptableObject.putProperty(spec, "dir", dir.isEmpty() ? "/" : dir);
            return spec;
        }
    }

    /** {@code loader.setCache(resolved, exports)} — stores executed module exports. */
    private final class SetCacheFn extends BaseFunction {
        @Override
        public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
            cache.put(Context.toString(args[0]), args[1]);
            return Undefined.instance;
        }
    }
}
