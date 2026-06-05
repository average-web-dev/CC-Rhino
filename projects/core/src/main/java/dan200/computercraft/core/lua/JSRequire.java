// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
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
 * CommonJS {@code require()} implementation for the Rhino-based JS machine.
 *
 * <p>Each computer has one root {@code JSRequire}. When a module is loaded, a bound copy is
 * created with {@code currentDir} set to that module's directory so that relative imports work.
 * Native CC APIs are registered via {@link #registerNative} and take priority over filesystem
 * modules.
 */
final class JSRequire extends BaseFunction {

    private final Scriptable globalScope;
    private final Map<String, Scriptable> nativeModules;
    private final @Nullable FileSystem fileSystem;
    private final String currentDir;
    private final JSRequire root;

    /** Create the root require for a computer. */
    JSRequire(Scriptable globalScope, @Nullable FileSystem fileSystem) {
        this.globalScope = globalScope;
        this.fileSystem = fileSystem;
        this.nativeModules = new HashMap<>();
        this.currentDir = "";
        this.root = this;
        setParentScope(globalScope);
        setPrototype(getFunctionPrototype(globalScope));
    }

    /** Bound require for a specific module directory — shares nativeModules and cache with root. */
    private JSRequire(JSRequire root, String currentDir) {
        this.globalScope = root.globalScope;
        this.fileSystem = root.fileSystem;
        this.nativeModules = root.nativeModules;
        this.currentDir = currentDir;
        this.root = root;
        setParentScope(root.globalScope);
        setPrototype(getFunctionPrototype(root.globalScope));
    }

    void registerNative(String id, Scriptable exports) {
        nativeModules.put(id, exports);
    }

    @Override
    public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
        if (args.length == 0) throw Context.reportRuntimeError("require() called with no arguments");
        var id = Context.toString(args[0]);
        return require(cx, id);
    }

    private Object require(Context cx, String id) {
        // 1. Native module registry takes priority
        var nativeMod = nativeModules.get(id);
        if (nativeMod != null) return nativeMod;

        // 2. Resolve to an absolute CC filesystem path
        var resolved = resolvePath(id);

        // 3. Module cache (stored on root require)
        var cache = (Scriptable) ScriptableObject.getProperty(root, "cache");
        var cached = ScriptableObject.getProperty(cache, resolved);
        if (cached != Scriptable.NOT_FOUND) return cached;

        // 4. Load source from CC filesystem
        var source = loadSource(id, resolved);

        // 5. Evaluate and cache
        return evalModule(cx, resolved, source, cache);
    }

    private String resolvePath(String id) {
        String candidate;
        if (id.startsWith("./") || id.startsWith("../")) {
            var base = currentDir.isEmpty() ? id : currentDir + "/" + id;
            candidate = addJsExtension(normalize(base));
        } else if (id.startsWith("/")) {
            candidate = addJsExtension(normalize(id));
        } else {
            // Bare name — search require.paths (array stored on root require)
            var paths = ScriptableObject.getProperty(root, "paths");
            if (paths instanceof Scriptable pathList) {
                var lenVal = ScriptableObject.getProperty(pathList, "length");
                var len = lenVal == Scriptable.NOT_FOUND ? 0 : (int) Context.toNumber(lenVal);
                for (int i = 0; i < len; i++) {
                    var dir = Context.toString(pathList.get(i, pathList));
                    var c = addJsExtension(normalize(dir + "/" + id));
                    if (existsQuietly(c)) return c;
                }
            }
            // Fall back to root-relative
            candidate = addJsExtension(normalize(id));
        }
        return candidate;
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

    private Object evalModule(Context cx, String resolved, String source, Scriptable cache) {
        var wrapped = "(function(module,exports,require,__filename,__dirname){\n" + source + "\n})";
        var fn = (Function) cx.evaluateString(globalScope, wrapped, resolved, 0, null);

        var module = cx.newObject(globalScope);
        var exports = cx.newObject(globalScope);
        ScriptableObject.putProperty(module, "exports", exports);
        ScriptableObject.putProperty(module, "filename", resolved);
        ScriptableObject.putProperty(module, "id", resolved);

        var dir = FileSystem.getDirectory(resolved);
        var boundRequire = new JSRequire(root, dir);

        fn.call(cx, globalScope, module, new Object[]{ module, exports, boundRequire, resolved, dir });

        // Return module.exports — the module may have reassigned it
        var result = ScriptableObject.getProperty(module, "exports");
        ScriptableObject.putProperty(cache, resolved, result);
        return result;
    }

    @Override
    public String getFunctionName() {
        return "require";
    }
}
