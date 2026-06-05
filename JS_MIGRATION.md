# CC: Tweaked — Lua/Cobalt → Rhino JS Migration

Replace the Cobalt Lua runtime with a Mozilla Rhino-based JavaScript engine.
Users write JavaScript (ES6 subset) instead of Lua inside the mod.

**API design:**

- Events → `os.on("redstone", cb)` / `os.once("char", cb)` — `os` obtained via `require('os')`
- Blocking ops → synchronous `turtle.dig()` — Rhino continuations yield the script, let other events fire, then resume transparently
- Modules → CommonJS `require()` for everything: Java-backed APIs (`turtle`, `os`, `term`, …) and user/ROM files alike
- **No implicit globals** — `require` is the only global injected by the runtime; all APIs must be required explicitly

**Key constraints:**

- Rhino interpreter mode (`optimizationLevel(-1)`) — pure Java JAR, no per-OS native builds; interpreter mode is also required for continuations
- `Context.setInstructionObserverThreshold()` safepoint — tight loops never lock up the system
- `ILuaMachine` / `MachineEnvironment` interface surface stays unchanged
- All Java API implementations (turtle, fs, peripheral, …) kept as-is

**Event loop model (how `os.on` survives a blocking `turtle.dig()`):**

```text
┌─────────────────────────────────────────────────────────┐
│  Computer thread (Rhino Context)                        │
│                                                         │
│  handleEvent("__start__")                               │
│    → eval bios.js → user code registers os.on(…)        │
│                                                         │
│  handleEvent("turtle_response")           ←── wakes up  │
│    → resumes stored continuation with dig result        │
│    → JS continues: const ok = turtle.dig()  ← returns  │
│                                                         │
│  handleEvent("redstone")                  ← fires WHILE │
│    → fires os.on("redstone", cb) callbacks   dig waits  │
└─────────────────────────────────────────────────────────┘
```

`turtle.dig()` captures a Rhino `ContinuationPending`, stores it, submits the
main-thread task non-blocking, then **returns OK** to the CC scheduler.
While the dig is pending, `handleEvent()` keeps dispatching other events normally.
When the `task_complete` event arrives, it resumes the stored continuation — JS
continues from the `turtle.dig()` call site with the return value.

---

## Phase 1 — Project setup & dependency wiring

- [ ] **1.1** Add Rhino to `gradle/libs.versions.toml`:
  - `[versions]` entry: `rhino = "1.7.15"`
  - `[libraries]` entry: `rhino = { module = "org.mozilla:rhino", version.ref = "rhino" }`
- [ ] **1.2** Replace GraalJS `implementation` dependency in `projects/core/build.gradle.kts` with `implementation(libs.rhino)`; keep Cobalt for now
- [ ] **1.3** Add `public static int jsInstructionThreshold = 10_000;` to `CoreConfig.java`
- [ ] **1.4** Smoke-check: `./gradlew :core:compileJava` passes with no errors

---

## Phase 2 — JSMachine skeleton

- [ ] **2.1** Create `projects/core/src/main/java/dan200/computercraft/core/lua/JSMachine.java` implementing `ILuaMachine`
  - Fields: `Context cx`, `Scriptable scope`, `boolean started`, `boolean isDisposed`
  - Constructor:
    - `cx = Context.enter()`
    - `cx.setOptimizationLevel(-1)` — interpreter mode (required for continuations and safepoints)
    - `cx.setLanguageVersion(Context.VERSION_ES6)`
    - `cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold)`
    - `cx.setClassShutter(name -> false)` — block all Java class access from JS
    - `scope = cx.initStandardObjects()`
  - `handleEvent(String name, Object[] args)` → runs bios on first call (startup), returns `MachineResult.OK`
  - `printExecutionState()` → stub
  - `close()` → `isDisposed = true; Context.exit()`
- [ ] **2.2** Create `projects/core/src/main/java/dan200/computercraft/core/computer/JSContext.java` implementing `ILuaContext`
  - `issueMainThreadTask()` → same as `LuaContext` (queue via `computer.queueMainThread()`, return task ID)
  - `executeMainThreadTask()`: See Phase 5 — this is where continuations are captured instead of blocking
- [ ] **2.3** In `ComputerContext.Builder.build()` change the default factory from `CobaltLuaMachine::new` to `JSMachine::new`
- [ ] **2.4** Create `projects/core/src/main/resources/data/computercraft/js/bios.js` — minimal stub: `var term = require('term'); term.write("JS bios loaded");`
- [ ] **2.5** In `ComputerExecutor.createLuaMachine()` change the resource path from `"lua/bios.lua"` to `"js/bios.js"`, and pass `JSContext` instead of `LuaContext`
- [ ] **2.6** Verify: `JSMachineTest` (3 tests) — boot returns OK, `print()` runs without error, subsequent events return OK

---

## Phase 3 — Tight loop safepoint (observeInstructionCount)

- [ ] **3.1** Subclass `ContextFactory` as `CCContextFactory` in `JSMachine`:
  - Override `observeInstructionCount(Context cx, int instructionCount)`:
    - `isDisposed || timeout.isHardAborted()` → `throw new EvaluatorException("hard abort")` (terminates script)
    - `timeout.isSoftAborted()` → `throw new EvaluatorException(ABORT_MESSAGE)`
    - `timeout.isPaused()` → spin-wait with `LockSupport.parkNanos(1ms)` (blocks this call; Rhino will retry)
    - Normal → return (threshold resets automatically, execution continues)
  - Register via `ContextFactory.initGlobal(new CCContextFactory())`
- [ ] **3.2** In `handleEvent()` / `mapException()`: catch `EvaluatorException` / `RhinoException`:
  - Message equals hard-abort sentinel → `MachineResult.TIMEOUT`
  - Message equals `ABORT_MESSAGE` → `error(ABORT_MESSAGE)`
  - Other → `error(message)` + close
- [ ] **3.3** `onTimeoutChanged()` listener calls `cx.observeInstructionCount(cx, 0)` on hard abort as a wake signal — the safepoint will then throw the hard abort exception on the next instruction check

---

## Phase 4 — EventEmitter bridge

- [ ] **4.1** Embed a minimal EventEmitter JS object (`on/once/off/emit/listenerCount`) in `JSMachine`; eval at construction, store as `emitterObj` field in `scope`

  ```js
  var __emitter__ = (function() {
    var listeners = {};
    return {
      on: function(event, fn) { (listeners[event] = listeners[event] || []).push({ fn: fn, once: false }); },
      once: function(event, fn) { (listeners[event] = listeners[event] || []).push({ fn: fn, once: true }); },
      off: function(event, fn) { if (listeners[event]) listeners[event] = listeners[event].filter(function(l) { return l.fn !== fn; }); },
      emit: function(event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var ls = listeners[event] ? listeners[event].slice() : [];
        listeners[event] = (listeners[event] || []).filter(function(l) { return !l.once; });
        ls.forEach(function(l) { l.fn.apply(null, args); });
      },
      listenerCount: function(event) { return (listeners[event] || []).length; }
    };
  })();
  ```

- [ ] **4.2** Do **not** inject `os` as a global. Instead, register a native `os` module (see Phase 6) that merges the CC `os` Java API with the EventEmitter methods. The `__emitter__` object is held privately on the Java side (`JSMachine.emitter`); `require('os')` returns a `NativeObject` that includes both `on/once/off` (delegating to `__emitter__`) and all CC os API methods.
- [ ] **4.3** `handleEvent(String name, Object[] args)`:
  - First call (`!started`) → `started = true` → eval bios.js → call Java-side `emitter.emit("__start__")`
  - Subsequent calls → convert `args` via `toJsValue()` → call Java-side `emitter.emit(name, jsArgs...)`
  - `toJsValue()` handles: null → `null`; Boolean/Number/String → wrap; byte[]/ByteBuffer → JS array; Map/Collection → `NativeObject`/`NativeArray`; recursive, cycle-safe
- [ ] **4.4** `dispatchEvent` returns `MachineResult.OK` immediately when `name` is null

---

## Phase 5 — Continuation-based blocking API bridge

This is the heart of the event loop. Instead of blocking the computer thread inside
`executeMainThreadTask()`, we capture a Rhino continuation and return immediately.
The CC scheduler remains free to process other events while the main-thread task runs.

- [ ] **5.1** Create `JSValues.java` — bidirectional Java ↔ JS value converter
  - `toJS(Scriptable scope, Object java)` → handles null, Number, Boolean, String, byte[], Map, Collection, Object[], ILuaFunction, IDynamicLuaObject (recursive, cycle-safe)
  - `toJava(Object v)` → unwrap NativeObject/NativeArray/primitives back to Java types
- [ ] **5.2** `JSArguments.java` — `IArguments` backed by `Object[]` (Rhino values); `get()` uses `JSValues.toJava()`; `drop()` via offset
- [ ] **5.3** `JSMethodBridge.java` — `BaseFunction` wrapping `LuaMethod`:
  - `call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args)`:
    - Wrap args as `JSArguments`
    - If method requires `ILuaContext` (i.e. calls `executeMainThreadTask`): capture continuation via `throw cx.captureContinuation()` after queuing; see **5.4**
    - No-callback methods: call method, convert result with `JSValues.toJS()`, return directly
- [ ] **5.4** Continuation flow in `JSContext.executeMainThreadTask()`:
  - Queue task via `computer.queueMainThread()` (non-blocking, stores `taskId`)
  - Capture continuation: `throw cx.captureContinuation()` — **this unwinds the Rhino call stack back to `handleEvent()`**
  - `handleEvent()` catches `ContinuationPending`:
    - Store `ContinuationPending continuation` + `int taskId` in `JSMachine` as `pendingContinuation` / `pendingTaskId`
    - Return `MachineResult.OK` — scheduler is now free to handle other events
  - When CC fires `"task_complete"` event with `[taskId, success, results...]`:
    - `handleEvent("task_complete", args)` detects `pendingTaskId` matches
    - Converts result via `JSValues.toJS()`
    - Calls `cx.resumeContinuation(pendingContinuation.getContinuation(), scope, jsResult)` — JS resumes from `turtle.dig()` call site
    - Clears `pendingContinuation` / `pendingTaskId`
  - While task is pending, all other events (`"redstone"`, `"char"`, etc.) are dispatched normally via `__emitter__.emit()` — `os.on()` callbacks fire as usual
- [ ] **5.5** `JSAPIBuilder.java` — enumerates methods via `forEachMethod`, wraps each as `JSMethodBridge`, returns `NativeObject` (scriptable map)
- [ ] **5.6** `JSMachine` constructor registers every CC API as a **native module** in `JSRequire` (not as a global):
  - `jsRequire.registerNative(api.getModuleName(), JSAPIBuilder.build(api))` for each API in `env.apis()`
  - Special case for the `os` API: merge its `NativeObject` with the EventEmitter `on/once/off` methods so `require('os')` returns a single unified object
  - The only global set on `scope` is `require` itself
- [ ] **5.7** `bios.js` updated — loads `term` and `os` via `require`; `print` is a plain JS helper defined in bios.js using `require('term')`:

  ```js
  var term = require('term');
  var os   = require('os');
  function print(text) { term.write(String(text)); term.setCursorPos(1, term.getCursorPos()[1] + 1); }
  ```

---

## Phase 6 — CommonJS `require()` module resolver

- [ ] **6.1** `JSRequire.java` — `BaseFunction` implementing CommonJS `require(id)`:
  - Resolution order for `id`:
    1. **Native module registry** — `nativeModules.get(id)` (Java `Map<String, Scriptable>`); return immediately if found (no caching needed, they are singletons)
    2. **Path resolution** for file-based modules:
       - Starts with `/` → absolute CC filesystem path
       - Starts with `./` or `../` → relative to the requiring file's directory
       - Otherwise → search `require.paths` (default: `["/rom/apis"]`)
       - Append `.js` if no extension
    3. **Module cache** — `require.cache[resolvedPath]`; return cached `exports` if present
    4. **Filesystem load** — read bytes from CC `FileSystem`; throw `Error("MODULE_NOT_FOUND: " + id)` if absent
  - Wrap source: `(function(module,exports,require,__filename,__dirname){` + source + `\n})`
  - Eval with `cx.evaluateString(moduleScope, wrapped, path, 1, null)`
  - Call wrapper with fresh `module = { exports: {} }` and `exports = module.exports`
  - Store `require.cache[resolvedPath] = module.exports`; return `module.exports`
- [ ] **6.2** `JSMachine` creates a `JSRequire` instance, exposes it as the **sole global** (`scope.put("require", scope, jsRequire)`); sets `require.paths = ["/rom/apis"]`; sets `require.cache = {}`; Java APIs are pre-registered via `jsRequire.registerNative(name, obj)` (see Phase 5.6)
- [ ] **6.3** `bios.js` `__start__` handler does `require("/startup")` (loads `/startup.js` if present); silently ignores `MODULE_NOT_FOUND` error

---

## Phase 7 — Sandboxing & security

- [ ] **7.1** Tighten Rhino access in `JSMachine` constructor:
  - `cx.setClassShutter(className -> false)` — blocks `Packages.*`, `java.*`, `importClass()`, etc.
  - Remove `Packages`, `java`, `javax`, `org`, `com`, `edu`, `net` from top-level scope: `ScriptableObject.deleteProperty(scope, "Packages")` etc.
  - Override `CCContextFactory.makeScope()` or post-init cleanup to strip `JavaImporter`
  - `cx.setOptimizationLevel(-1)` already set — no class generation, no reflection bypass via bytecode
- [ ] **7.2** Verify `java.lang.Runtime.getRuntime().exec("ls")` throws from JS
- [ ] **7.3** Verify API objects only expose wrapped `BaseFunction` methods, not arbitrary Java fields

---

## Phase 7.5 — JS ROM & standard library

Translate the Lua ROM (`lua/rom/`) into a JS equivalent so the computer is fully usable
out of the box — shell, built-in programs, standard library APIs, and startup sequence.

### 7.5.A — Resource layout

- [ ] **7.5.A.1** Create `projects/core/src/main/resources/data/computercraft/js/rom/` mirroring the structure of `lua/rom/`
- [ ] **7.5.A.2** Update `ComputerExecutor` to mount `js/rom` at `/rom` in the CC filesystem
- [ ] **7.5.A.3** Update `bios.js` to boot the JS shell (`/rom/programs/shell.js`) after loading startup scripts

### 7.5.B — Standard library JS APIs (`/rom/apis/`)

Each file uses CommonJS `module.exports = { ... }` and is loadable via `require('colors')` etc.
User code and ROM programs must require them explicitly — bios.js does not inject them as globals.

- [ ] **7.5.B.1** `colors.js` / `colours.js` — colour constants + `combine`, `subtract`, `test`, `packRGB`, `unpackRGB`
- [ ] **7.5.B.2** `keys.js` — key-name-to-keycode map (LWJGL key codes)
- [ ] **7.5.B.3** `textutils.js` — `serialize`/`unserialize` (JSON-compatible), `formatTime`, `tabulate`, `pagedTabulate`, `slowPrint`, `urlEncode`
- [ ] **7.5.B.4** `math.js` — thin wrappers / re-exports of JS `Math` with Lua-compatible naming (`math.floor`, `math.ceil`, `math.random`, `math.huge`, etc.)
- [ ] **7.5.B.5** `string.js` — Lua-style string library shim (`string.format`, `string.find`, `string.match`, `string.gmatch`, `string.gsub`, `string.rep`, `string.reverse`, `string.byte`, `string.char`, `string.len`, `string.sub`)
- [ ] **7.5.B.6** `table.js` — `table.insert`, `table.remove`, `table.concat`, `table.sort`, `table.unpack` shims over JS Array methods
- [ ] **7.5.B.7** `vector.js` — 3D vector class with `add`, `sub`, `mul`, `dot`, `cross`, `length`, `normalize`, `tostring`
- [ ] **7.5.B.8** `window.js` — terminal window API (sub-terminal redirects)

### 7.5.C — Shell & REPL (`/rom/programs/`)

- [ ] **7.5.C.1** `shell.js` — interactive shell: reads a line, splits into program + args, looks up `/rom/programs/<cmd>.js` or `/<cmd>.js`, requires and runs it; handles `exit`, `cd`, `path`
- [ ] **7.5.C.2** `ls.js` — lists files in the current/given directory
- [ ] **7.5.C.3** `help.js` — reads `/rom/help/<topic>.md` and prints it to the terminal
- [ ] **7.5.C.4** `edit.js` — minimal line editor: open/create a file, edit lines, save
- [ ] **7.5.C.5** `reboot.js` and `shutdown.js` — call `os.reboot()` / `os.shutdown()`
- [ ] **7.5.C.6** `echo.js`, `clear.js`, `time.js`, `id.js` — trivial one-liners

### 7.5.D — `read()` and terminal helpers in bios.js

- [ ] **7.5.D.1** Implement `read(replaceChar, history, completeFn)` in bios.js using `os.on("char", ...)` / `os.on("key", ...)` — each keypress resumes the pending continuation via the CC event loop; `os` is obtained via `require('os')` at the top of bios.js
- [ ] **7.5.D.2** Implement `write(text)` (no newline) using `require('term').write()` + cursor tracking; both `write` and `print` are plain JS functions defined in bios.js scope (not globals — shell programs that need them must `require('/bios')` or define their own)
- [ ] **7.5.D.3** Compat shims (`tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `pcall`, `xpcall`, `error`) — expose as a `require('compat')` module; programs that need Lua-familiar helpers do `var { tostring, pairs } = require('compat')`

### 7.5.E — Help text

- [ ] **7.5.E.1** Copy `lua/rom/help/` markdown files to `js/rom/help/`
- [ ] **7.5.E.2** Write `js/rom/help/index.md` listing all available JS programs/APIs

---

## Phase 8 — Testing

- [ ] **8.1** `JSMachineTest.java` — create `JSMachine` with a dummy `MachineEnvironment`; call `handleEvent(null, null)`; expect `MachineResult.OK`
- [ ] **8.2** `JSEventBridgeTest.java` — eval `var os = require('os'); os.on("foo", function(v) { result = v; })` from JS; call `handleEvent("foo", new Object[]{"bar"})` from Java; verify `result` equals `"bar"`
- [ ] **8.3** `JSBlockingAPITest.java` — mock a `LuaMethod` that calls `executeMainThreadTask`; verify continuation is captured on first `handleEvent`; fire `task_complete`; verify JS resumes with correct result
- [ ] **8.4** `JSConcurrentEventTest.java` — while a continuation is pending (dig in progress), call `handleEvent("redstone", ...)` and verify the `os.on("redstone", cb)` callback fires without resuming the dig continuation
- [ ] **8.5** `JSRequireTest.java` — write a virtual `.js` file to a test filesystem; `require()` it from bios.js; verify it executes and `module.exports` is returned
- [ ] **8.6** `JSSafePointTest.java` — run `while(true){}` in user JS; verify `MachineResult.TIMEOUT` or error is returned within a bounded time
- [ ] **8.7** Remove/adapt Cobalt-specific tests:
  - Delete `CobaltLuaTableTest.java`, `VarargArgumentsTest.java`, `ErrorInfoLibTest.java`
  - Adapt `ComputerTestDelegate.java` to use `JSMachine` instead of `CobaltLuaMachine`
  - Delete `LuaCoverage.java` (Lua-specific)

---

## Phase 9 — Cleanup & rename

- [ ] **9.1** Remove Cobalt from `gradle/libs.versions.toml` and `projects/core/build.gradle.kts`
- [ ] **9.2** Delete `CobaltLuaMachine.java`
- [ ] **9.3** Delete `ResultInterpreterFunction.java`
- [ ] **9.4** Delete `VarargArguments.java`
- [ ] **9.5** Delete `TableImpl.java`
- [ ] **9.6** Delete `errorinfo/ErrorInfoLib.java` and `errorinfo/DebugHelpers.java`
- [ ] **9.7** Delete `projects/web/src/builder/java/cc/tweaked/web/builder/PatchCobalt.java`
- [ ] **9.8** Rename `ILuaMachine` → `IMachine` and `ILuaMachine.Factory` → `IMachine.Factory` everywhere
- [ ] **9.9** Rename `MachineEnvironment`, `MachineResult`, `MachineException` Javadocs to drop Lua-specific language
- [ ] **9.10** Add SPDX headers (MPL-2.0) to all new source files
- [ ] **9.11** Decide (with user) whether to remove `lua/rom/` resources or keep Lua machine as opt-in fallback

---

## Phase 10 — Author ROM/bios in TypeScript, transpile on build

Move the hand-written `.js` sources (`data/computercraft/js/` — bios + `rom/apis/` + `rom/programs/`)
to TypeScript and transpile them to CommonJS `.js` during the Gradle build.

### 10.A — Mechanical conversion (transpile-on-build)

- [ ] **10.A.1** Create `projects/core/src/ts/` and move the `.js` files there as `.ts`
- [ ] **10.A.2** Add `projects/core/src/ts/tsconfig.json`:
  `module: commonjs`, `target: es2017`, `strict`, `noEmitOnError` — emits CommonJS `require()` calls, matching the Rhino runtime
- [ ] **10.A.3** Wire transpile into the `:core` build reusing `NpxExecToDir` task; `tsc` into `build/generated/js`
- [ ] **10.A.4** Feed generated dir into `processResources` under `data/computercraft/js/`; remove hand-written `.js` from `src/main/resources`
- [ ] **10.A.5** `noEmitOnError` — type errors fail the build
- [ ] **10.A.6** Verify: `./gradlew :core:processResources` emits `.js`; in-game boot still passes

### 10.B — Type definitions (optional, defer until API surface settles)

- [ ] **10.B.1** Write typed module declarations for all CC native modules: `declare module 'turtle' { ... }`, `declare module 'os' { ... }`, `declare module 'term' { ... }`, etc. — no `declare global` needed since nothing is injected globally
- [ ] **10.B.2** Model blocking calls as plain synchronous return types (e.g. `dig(): [boolean, string?]`), not Promise
- [ ] **10.B.3** Keep `.d.ts` in sync as Phase 7.5 / Phase 9 reshape the API surface

---

## Phase 11 — JS ROM feature planning (do this before writing any ROM code)

Before implementing any JS ROM program or API, go through every Lua file under
`projects/core/src/main/resources/data/computercraft/lua/rom/` and write a feature
description for each one. **Do not port the Lua code** — read it to understand what
capability it gives the user, then design a clean JS equivalent from scratch.

- [ ] **11.1** For each file in `lua/rom/apis/`, `lua/rom/programs/`, `lua/rom/modules/`, and
  `bios.lua`, write a one-line feature summary:
  - What it lets the user do (e.g. "full-screen text editor with syntax highlighting and
    tab-completion for API names")
  - Any CC-specific behaviour that must be preserved (key bindings, terminal colour usage,
    peripheral interaction, etc.)
  - Note whether it depends on other APIs so the implementation order is clear
- [ ] **11.2** Collect the summaries into a new `JS_ROM_FEATURES.md` document, one section per
  ROM subdirectory, structured as a design spec — not a port guide. Each entry should describe
  the feature contract (inputs, outputs, user-visible behaviour) that the JS implementation must
  satisfy, without referring to how the Lua version achieves it.
- [ ] **11.3** Use `JS_ROM_FEATURES.md` as the authoritative todo list when writing the files in
  Phase 7.5 — each Phase 7.5 checkbox maps to one feature spec from that document.

---

## Cross-cutting reference

| Concern | Approach |
| --- | --- |
| Tight loop | `cx.setInstructionObserverThreshold(N)` + `CCContextFactory.observeInstructionCount()` |
| Hard abort | `throw new EvaluatorException("hard abort")` from safepoint |
| Soft abort | `throw new EvaluatorException(ABORT_MESSAGE)` from safepoint |
| Pause/preemption | Spin-wait inside `observeInstructionCount()` until `isPaused()` clears |
| Main-thread tasks | Rhino continuation captured in JS; CC queues non-blocking task; `task_complete` event resumes continuation |
| Blocking during pending | Other `os.on()` events dispatch normally while continuation is stored |
| Rhino mode | `optimizationLevel(-1)` interpreter — pure Java, no class generation, continuations work |
| Security | `cx.setClassShutter(name -> false)`, strip `Packages`/`java` globals |
| Globals | Only `require` — all APIs (`os`, `turtle`, `term`, `fs`, …) must be loaded with `require()` |
| Event model | `var os = require('os'); os.on(event, cb)` — synchronous callbacks in `handleEvent()` |
| Sync ops | `turtle.dig()` returns value directly; no `await`, no Promise |
| Modules | `require(id)`: checks native registry first, then CC filesystem; `require.paths = ["/rom/apis"]` |
| Native modules | Java APIs registered by name in `JSRequire.nativeModules`; `os` merges CC os API + EventEmitter |
