<!--
SPDX-FileCopyrightText: 2026 average-web-dev

SPDX-License-Identifier: MPL-2.0
-->

# CC: Rhino — Lua/Cobalt → Rhino JS Migration

Replace the Cobalt Lua runtime with a Mozilla Rhino-based JavaScript engine.
Users write JavaScript (ES6 subset) instead of Lua inside the mod.

**API design:**

- Events → `events.on("redstone", cb)` / `events.once("char", cb)` — `events` obtained via `require('events')` (the global event bus)
- Blocking ops → synchronous `turtle.dig()` — Rhino continuations yield the script, let other events fire, then resume transparently
- Modules → CommonJS `require()` for everything: Java-backed APIs (`turtle`, `process`, `events`, `term`, …) and user/ROM files alike
- The old CC `os` is split into **`process`** (computer control + in-game time), **`events`** (event bus + timers/alarms) and global timer functions. See [JS_API_REDESIGN.md](JS_API_REDESIGN.md).
- **No implicit globals** — `require` is the only global injected by the runtime; all APIs must be required explicitly

**Key constraints:**

- Rhino interpreter mode (`optimizationLevel(-1)`) — pure Java JAR, no per-OS native builds; interpreter mode is also required for continuations
- `Context.setInstructionObserverThreshold()` safepoint — tight loops never lock up the system
- `ILuaMachine` / `MachineEnvironment` interface surface stays unchanged
- All Java API implementations (turtle, fs, peripheral, …) kept as-is

**Modern syntax on Rhino (#47):** Rhino (1.9.x with the backports of `average-web-dev/rhino`) lacks or breaks part of ES2015+ (no `class` syntax, `const` in loops
keeps its first value, no spread in calls, rest parameters wrong through `apply`, array destructuring ignores
iterators, no `new.target`, unparenthesized `yield` rejected, no `async`, …). TypeScript is therefore compiled by
`projects/core/src/build/compile-ts.mjs`: tsc only type-checks, then Babel strips the types and `babel-preset-rhino`
(`src/build/babel-preset-rhino/`) transforms exactly the features Rhino gets wrong (since #49 also `async` functions,
async generators and `for await`, to native generators) and turns ES modules into CommonJS; its runtime helpers come
from the engine's native `babel-helpers` module. ROM, test and user code use ES module syntax (`import fs from 'fs'`,
`export function main…`) and can use classes, spread, `const` in loops, rest/default parameters and destructuring
freely. `JSRhinoFeatureTest` pins the
feature matrix (what is native, what is transformed). Leaving a `for-of` early (`break`, `return`, labelled jumps,
exceptions) closes the iterator (#41): Rhino never calls `return()`, so the preset's own `for-of.mjs` plugin keeps the
native loop but over an iterator it obtained itself, and closes it on every jump out of the loop and, through
`try`/`finally`, on exceptions. Measured on Rhino's interpreter (1000-element loops; 333 loops over 3 elements):
arrays +3% / +50% (one inline `Array.isArray` and a `try` per loop entry; array literals are not transformed),
`Set` +10%, generators +1%, against +500% (`Set`) / +210% (generators) for Babel's `transform-for-of` (a closure
call per step) and a 2× slowdown of the whole function for any variant that uses `catch`. Array destructuring is
closed by Babel's `slicedToArray` helper, `for await` by Babel's lowering (`asyncIterator` + `return()`). Remaining
deviations: an iterator whose `next()` throws still gets `return()` called (errors ignored), and an array whose
`Symbol.iterator` was replaced is iterated with it but not closed.

**Event loop model (how `events.on` survives a blocking `turtle.dig()`):**

```text
┌─────────────────────────────────────────────────────────┐
│  Computer thread (Rhino Context)                        │
│                                                         │
│  handleEvent("__start__")                               │
│    → eval bios.js → user code registers events.on(…)   │
│                                                         │
│  handleEvent("turtle_response")           ←── wakes up  │
│    → resumes stored continuation with dig result        │
│    → JS continues: const ok = turtle.dig()  ← returns  │
│                                                         │
│  handleEvent("redstone")                  ← fires WHILE │
│    → fires events.on("redstone", cb) callbacks dig waits│
└─────────────────────────────────────────────────────────┘
```

`turtle.dig()` captures a Rhino `ContinuationPending`, stores it, submits the
main-thread task non-blocking, then **returns OK** to the CC scheduler.
While the dig is pending, `handleEvent()` keeps dispatching other events normally.
When the `task_complete` event arrives, it resumes the stored continuation — JS
continues from the `turtle.dig()` call site with the return value.

---

## Commit convention

After completing every phase:

1. `git add` all files introduced or modified by that phase (list them explicitly — no `git add .`)
2. Propose a commit message using the format below; do **not** run `git commit` until the user explicitly approves
3. The `Co-Authored-By` trailer marks the commit as AI-generated and must always be present

```text
feat(js-engine): <one-line summary of the phase>

<2–3 sentences describing what was implemented and why>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Phase 1 — Project setup & dependency wiring

- [x] **1.1** Add Rhino to `gradle/libs.versions.toml`:
  - `[versions]` entry: `rhino = "1.9.1"`
  - `[libraries]` entry: `rhino = { module = "org.mozilla:rhino", version.ref = "rhino" }`
- [x] **1.2** Replace GraalJS `implementation` dependency in `projects/core/build.gradle.kts` with `implementation(libs.rhino)`; keep Cobalt for now
- [x] **1.3** Add `public static int jsInstructionThreshold = 10_000;` to `CoreConfig.java`
- [x] **1.4** Smoke-check: `./gradlew :core:compileJava` passes with no errors
- [x] **Commit** — stage Phase 1 files; propose commit message; wait for user approval

---

## Phase 1.5 — TypeScript build pipeline

Set up the transpile-on-build pipeline before writing any bios or ROM files.
All JS authored for the CC runtime lives under `projects/core/src/ts/` and is never
committed as raw `.js` — Gradle emits the `.js` output into the resource tree.

- [x] **1.5.1** Add `projects/core/src/ts/tsconfig.json`:
  `module: commonjs`, `target: es2017`, `strict`, `noEmitOnError` — emits CommonJS `require()` calls, matching the Rhino runtime
- [x] **1.5.2** Wire transpile into the `:core` build reusing `NpxExecToDir` task; `tsc` outputs into `build/generated/js`
- [x] **1.5.3** Feed generated dir into `processResources` under `data/computercraft/js/`
- [x] **1.5.4** Smoke-check: `./gradlew :core:processResources` succeeds (empty `src/ts/` is fine at this point)
- [x] **Commit** — stage Phase 1.5 files; propose commit message; wait for user approval

---

## Phase 2 — JSMachine skeleton

- [x] **2.1** Create `projects/core/src/main/java/dan200/computercraft/core/lua/JSMachine.java` implementing `ILuaMachine`
  - Fields: `Context cx`, `Scriptable scope`, `boolean started`, `boolean isDisposed`
  - Constructor:
    - `cx = Context.enter()`
    - `cx.setOptimizationLevel(-1)` — interpreter mode (required for continuations and safepoints)
    - `cx.setLanguageVersion(Context.VERSION_ES6)`
    - `cx.setInstructionObserverThreshold(CoreConfig.jsInstructionThreshold)`
    - `cx.setClassShutter(name -> false)` — block all Java class access from JS
    - `scope = cx.initSafeStandardObjects()` — no LiveConnect globals (Packages, java, getClass, …)
  - `handleEvent(String name, Object[] args)` → runs bios on first call (startup), returns `MachineResult.OK`
  - `printExecutionState()` → stub
  - `close()` → `isDisposed = true; Context.exit()`
- [x] **2.2** Create `projects/core/src/main/java/dan200/computercraft/core/computer/JSContext.java` implementing `ILuaContext`
  - `issueMainThreadTask()` → same as `LuaContext` (queue via `computer.queueMainThread()`, return task ID)
  - `executeMainThreadTask()`: See Phase 5 — this is where continuations are captured instead of blocking
- [x] **2.3** In `ComputerContext.Builder.build()` change the default factory from `CobaltLuaMachine::new` to `JSMachine::new`
- [x] **2.4** Create `projects/core/src/ts/bios.ts` — minimal stub (transpiles to `data/computercraft/js/bios.js` at build time):

  ```ts
  const term = require('term');
  term.write("JS bios loaded");
  ```

- [x] **2.5** In `ComputerExecutor.createLuaMachine()` change the resource path from `"lua/bios.lua"` to `"js/bios.js"` (the transpiled output), and pass `JSContext` instead of `LuaContext`
- [x] **2.6** Verify: `JSMachineTest` (3 tests) — boot returns OK, `print()` runs without error, subsequent events return OK
- [x] **Commit** — stage Phase 2 files; propose commit message; wait for user approval

---

## Phase 3 — CommonJS `require()` module resolver

- [x] **3.1** `JSRequire.java` — `BaseFunction` implementing CommonJS `require(id)`:
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
- [x] **3.2** `JSMachine` creates a `JSRequire` instance, exposes it as the **sole global** (`scope.put("require", scope, jsRequire)`); sets `require.paths = ["/rom/apis"]`; sets `require.cache = {}`; Java APIs are pre-registered via `jsRequire.registerNative(name, obj)` (see Phase 6.6)
- [x] **3.3** `bios.ts` `__start__` handler does `require("/startup")` (loads `/startup.js` if present); silently ignores `MODULE_NOT_FOUND` error
- [x] **Commit** — stage Phase 3 files; propose commit message; wait for user approval

---

## Phase 4 — Tight loop safepoint (observeInstructionCount)

- [x] **4.1** Subclass `ContextFactory` as `CCContextFactory` in `JSMachine`:
  - Override `observeInstructionCount(Context cx, int instructionCount)`:
    - `isDisposed || timeout.isHardAborted()` → `throw new EvaluatorException("hard abort")` (terminates script)
    - `timeout.isSoftAborted()` → `throw new EvaluatorException(ABORT_MESSAGE)`
    - `timeout.isPaused()` → spin-wait with `LockSupport.parkNanos(1ms)` (blocks this call; Rhino will retry)
    - Normal → return (threshold resets automatically, execution continues)
  - Register via `ContextFactory.initGlobal(new CCContextFactory())`
- [x] **4.2** In `handleEvent()` / `mapException()`: catch `EvaluatorException` / `RhinoException`:
  - Message equals hard-abort sentinel → `MachineResult.TIMEOUT`
  - Message equals `ABORT_MESSAGE` → `error(ABORT_MESSAGE)`
  - Other → `error(message)` + close
- [x] **4.3** `onTimeoutChanged()` listener calls `cx.observeInstructionCount(cx, 0)` on hard abort as a wake signal — the safepoint will then throw the hard abort exception on the next instruction check
- [x] **Commit** — stage Phase 4 files; propose commit message; wait for user approval

---

## Phase 5 — EventEmitter bridge

The listener registry is implemented entirely in Java — no JS eval, no embedded string, no
resource file. This avoids bridging overhead and keeps the event infrastructure as a plain Java
object with a clear lifecycle tied to `JSMachine`.

- [x] **5.1** Create `JSEventEmitter.java`:
  - Inner record `ListenerEntry(Callable fn, boolean once)`
  - Field: `Map<String, List<ListenerEntry>> listeners = new HashMap<>()`
  - `void on(String event, Callable fn)` — appends `ListenerEntry(fn, false)`
  - `void once(String event, Callable fn)` — appends `ListenerEntry(fn, true)`
  - `void off(String event, Callable fn)` — removes entries whose `fn` matches
  - `void emit(Context cx, Scriptable scope, String event, Object[] jsArgs)` — snapshots the list, removes `once` entries, calls each `fn.call(cx, scope, scope, jsArgs)`
  - `int listenerCount(String event)` — returns list size
- [x] **5.2** Do **not** inject anything as a global. Instead, register a native `events` module (see Phase 3) that exposes the emitter. `JSMachine` holds `JSEventEmitter emitter` as a field; `require('events')` returns a `NativeObject` wrapping `emitter.on/once/off/listenerCount` as `BaseFunction` instances, plus `emit`/`queueEvent` and the CC timer/alarm methods (`startTimer`, `cancelTimer`, `setAlarm`, `cancelAlarm`). The remaining CC `os` methods (shutdown, reboot, label, clock, in-game time/day/epoch) are registered as a separate `process` module. See [JS_API_REDESIGN.md](JS_API_REDESIGN.md) for the split.
- [x] **5.3** `handleEvent(String name, Object[] args)`:
  - First call (`!started`) → `started = true` → eval bios.js resource → `emitter.emit(cx, scope, "__start__", new Object[0])`
  - Subsequent calls → convert `args` via `toJsValue()` → `emitter.emit(cx, scope, name, jsArgs)`
  - `toJsValue()` handles: null → `null`; Boolean/Number/String → wrap; byte[]/ByteBuffer → JS array; Map/Collection → `NativeObject`/`NativeArray`; recursive, cycle-safe
- [x] **5.4** `handleEvent` returns `MachineResult.OK` immediately when `name` is null
- [x] **Commit** — stage Phase 5 files; propose commit message; wait for user approval

---

## Phase 6 — Continuation-based blocking API bridge

This is the heart of the event loop. Instead of blocking the computer thread inside
`executeMainThreadTask()`, we capture a Rhino continuation and return immediately.
The CC scheduler remains free to process other events while the main-thread task runs.

- [x] **6.1** Create `JSValues.java` — bidirectional Java ↔ JS value converter
  - `toJS(Scriptable scope, Object java)` → handles null, Number, Boolean, String, byte[], Map, Collection, Object[], ILuaFunction, IDynamicLuaObject (recursive, cycle-safe)
  - `toJava(Object v)` → unwrap NativeObject/NativeArray/primitives back to Java types
- [x] **6.2** `JSArguments.java` — `IArguments` backed by `Object[]` (Rhino values); `get()` uses `JSValues.toJava()`; `drop()` via offset
- [x] **6.3** `JSMethodBridge.java` — `BaseFunction` wrapping `LuaMethod`:
  - `call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args)`:
    - Wrap args as `JSArguments`
    - If method requires `ILuaContext` (i.e. calls `executeMainThreadTask`): capture continuation via `throw cx.captureContinuation()` after queuing; see **6.4**
    - No-callback methods: call method, convert result with `JSValues.toJS()`, return directly
- [x] **6.4** Continuation flow in `JSContext.executeMainThreadTask()`:
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
  - While task is pending, all other events (`"redstone"`, `"char"`, etc.) are dispatched normally via `__emitter__.emit()` — `events.on()` callbacks fire as usual
- [x] **6.5** `JSAPIBuilder.java` — enumerates methods via `forEachMethod`, wraps each as `JSMethodBridge`, returns `NativeObject` (scriptable map)
- [x] **6.6** `JSMachine` constructor registers every CC API as a **native module** in `JSRequire` (not as a global):
  - `jsRequire.registerNative(api.getModuleName(), JSAPIBuilder.build(api))` for each API in `env.apis()`
  - Split the CC `os` API: the EventEmitter `on/once/off` + `emit`/timers/alarms become the `events` module; the rest (shutdown, reboot, label, clock, in-game time) become the `process` module
  - The only global set on `scope` is `require` itself; the bios adds `process`, `console` and the Node timer functions (`setTimeout`/`setInterval`/`setImmediate` + clear functions, `queueMicrotask`; #45). There is no global `sleep` (`system.sleep(ticks)`)
- [x] **6.7** `bios.ts` updated — loads `term` via `require`; `print` is a plain TS helper defined in `bios.ts`. Terminal coordinates are **0-based** and `getCursorPos()` returns an object:

  ```ts
  const term = require('term');
  function print(text: string): void { term.write(String(text)); const { y } = term.getCursorPos(); term.setCursorPos(0, y + 1); }
  ```

- [x] **Commit** — stage Phase 6 files; propose commit message; wait for user approval

---

## Phase 7 — Sandboxing & security

- [x] **7.1** Tighten Rhino access in `JSMachine` constructor:
  - `cx.setClassShutter(className -> false)` — blocks `Packages.*`, `java.*`, `importClass()`, etc.
  - Remove `Packages`, `java`, `javax`, `org`, `com`, `edu`, `net` from top-level scope: `ScriptableObject.deleteProperty(scope, "Packages")` etc.
  - Override `CCContextFactory.makeScope()` or post-init cleanup to strip `JavaImporter`
  - `cx.setOptimizationLevel(-1)` already set — no class generation, no reflection bypass via bytecode
- [x] **7.2** Verify `java.lang.Runtime.getRuntime().exec("ls")` throws from JS — covered by `java_runtime_exec_is_blocked()` and `java_packages_global_is_removed()` / `java_interop_globals_are_removed()` tests
- [x] **7.3** Verify API objects only expose wrapped `BaseFunction` methods, not arbitrary Java fields — guaranteed by `JSAPIBuilder` which only puts `JSMethodBridge` (BaseFunction) instances on the returned NativeObject; no raw Java references are exposed
- [x] **Commit** — stage Phase 7 files; propose commit message; wait for user approval

---

## Phase 7.5 — ROM filesystem wiring

Wire the ROM directory into the CC filesystem so Phase 11 programs are accessible at runtime.
Do **not** write any `.ts` files under `src/ts/rom/` here — all ROM content is authored in Phase 11
after `JS_ROM_FEATURES.md` defines the feature contracts.

- [x] **7.5.1** Create `projects/core/src/ts/rom/` (empty placeholder; populated in Phase 11)
- [x] **7.5.2** Update `ComputerExecutor` to mount `js/rom` at `/rom` in the CC filesystem
- [ ] **7.5.3** Update `bios.ts` to attempt `require("/startup")` (silently ignores `MODULE_NOT_FOUND`) then boot `/rom/programs/shell.js` — *bios now boots `/rom/os` → `/rom/bin/bash`; startup scripts are tracked in #1*
- [ ] **Commit** — stage Phase 7.5 files; propose commit message; wait for user approval

---

## Phase 8 — Testing

- [x] **8.1** `JSMachineTest.java` — create `JSMachine` with a dummy `MachineEnvironment`; call `handleEvent(null, null)`; expect `MachineResult.OK`
- [x] **8.2** `JSEventBridgeTest.java` — eval `var os = require('os'); os.on("foo", cb)` from JS (the emitter is exposed on the `os` module, not a separate `events` module); call `handleEvent("foo", new Object[]{"bar"})` from Java; verify the callback receives `"bar"`. Also covers `once`/`off`.
- [x] **8.3** `JSBlockingAPITest.java` — mock an `ApiMethod` that calls `executeMainThreadTask`; verify the continuation is captured on the first `handleEvent` (code after the call has not run); fire `task_complete`; verify JS resumes with the task result. Also covers a non-matching task id.
- [x] **8.4** `JSConcurrentEventTest.java` — while a continuation is pending (dig in progress), call `handleEvent("redstone", ...)` and verify the `os.on("redstone", cb)` callback fires without resuming the dig continuation; then `task_complete` resumes it.
- [x] **8.5** `JSRequireTest.java` — write a virtual `.js` file to a `MemoryMount` filesystem; `require()` it from bios.js; verify it executes and `module.exports` is returned, is cached across requires, and that a missing module throws `MODULE_NOT_FOUND`.
- [x] **8.6** `JSSafePointTest.java` — run `while(true){}` in user JS and trigger an abort from another thread; verify `MachineResult.TIMEOUT` (hard) / abort-message error (soft) is returned within a bounded time.
- [x] **8.7** Remove/adapt Cobalt-specific tests: — *done: Cobalt tests deleted; `ComputerBootstrap`/`MethodTest`/`ComputerTest` ported to JS*
  - Delete `CobaltLuaTableTest.java`, `VarargArgumentsTest.java`, `ErrorInfoLibTest.java`
  - Adapt `ComputerTestDelegate.java` to use `JSMachine` instead of `CobaltLuaMachine`
  - Delete `LuaCoverage.java` (Lua-specific)
- [ ] **Commit** — stage Phase 8 files; propose commit message; wait for user approval

---

## Phase 9 — Cleanup & rename

- [x] **9.1** Remove Cobalt from `gradle/libs.versions.toml`, `projects/core/build.gradle.kts`, `projects/fabric/build.gradle.kts`, `projects/forge/build.gradle.kts`
- [x] **9.2** Delete `CobaltLuaMachine.java`
- [x] **9.3** Delete `ResultInterpreterFunction.java`
- [x] **9.4** Delete `VarargArguments.java`
- [x] **9.5** Delete `TableImpl.java`
- [x] **9.6** Delete `errorinfo/ErrorInfoLib.java` and `errorinfo/DebugHelpers.java`
- [x] **9.7** Delete `projects/web/src/builder/java/cc/tweaked/web/builder/PatchCobalt.java`; remove `PatchCobalt::patch` transformer from `Builder.java`; update `TComputerThread.java` comment
- [x] **9.8** Rename `ILuaMachine` → `IMachine` and `ILuaMachine.Factory` → `IMachine.Factory` everywhere (including `KotlinLuaMachine.kt`)
- [x] **9.9** Rename `MachineEnvironment`, `MachineResult`, `MachineException`, `TimeoutState` Javadocs to drop Lua-specific language
- [x] **9.10** All new JS-engine source files already carry MPL-2.0 SPDX headers
- [x] **Commit** — stage Phase 9 files; propose commit message; wait for user approval

---

## Phase 10 — TypeScript type definitions

The build pipeline is already running from Phase 1.5. This phase adds typed module declarations
so the TypeScript compiler can check all ROM/bios sources against the actual CC API surface.
Defer until the API surface has stabilised (after Phase 9).

- [x] **10.1** Typed module declarations for all CC native modules live in `projects/core/src/ts/types/` — one `.d.ts` per module (`fs`, `path`, `process`, `events`, `http`, `term`, `redstone`, `peripheral`, `turtle`, `commands`, `pocket`), plus `globals.d.ts` (`require` overloads), `timers.d.ts` (timer globals, `timers`, `timers/promises`) and `modules.d.ts` (ambient `declare module` for `import` syntax). The `bundleTypeDeclarations` Gradle task collects all `.d.ts` into `build/generated/types/` for publishing as an npm types package. See [JS_API_REDESIGN.md](JS_API_REDESIGN.md).
- [x] **10.2** Model blocking calls as plain synchronous return types — "can-fail" actions return `Result` `{ success: boolean, reason?: string }` (not a tuple, not a Promise; the generated `<module>/promises` flavour wraps the same types in `Promise<T>`, #35)
- [x] **10.3** Keep `.d.ts` in sync as Phase 11 / Phase 9 reshape the API surface — `transpileTypeScript` (part of `assemble`) type-checks the ROM against freshly generated types, and the tsdoclet fails on undocumented `unknown`s
- [x] **10.4** Audit every `@LuaFunction` method across all API classes (`TurtleMethods`, `FsMethods`, `RedstoneMethods`, `PeripheralAPI`, `HttpMethods`, `PocketAPI`, `CommandsMethods`, etc.) and migrate:
  - **Complex return types** — any method returning `Map<String, ?>`, `Object[]` tuple, or multi-value `MethodResult` that represents a structured value should instead return a typed Java record. The `JSValues.toJs()` record branch and `LuaUtil.toRecord()` infrastructure is already in place.
  - **Complex parameters** — any method taking a `Map<?, ?>` or manually destructuring an `IArguments` table should instead declare a typed Java record parameter; `Generator.java` already generates the coercion automatically.
  - Update the corresponding `.d.ts` interfaces to reflect the record shapes (field names must match Java record component names since `JSValues` uses reflection).
- [ ] **Commit** — stage Phase 10 files; propose commit message; wait for user approval

---

## Phase 11 — JS ROM feature planning & implementation

### 11.A — Planning (do this before writing any ROM code)

- [x] **11.1** Read every Lua file under `lua/rom/` and write a one-line feature summary per file.
- [x] **11.2** Collect summaries into `JS_ROM_FEATURES.md` as a JS design spec (not a port guide).

### 11.A.1 — Architecture concept (Linux-inspired OS layer)

The Lua ROM glued everything together in `bios.lua`: globals, shell path, aliases, autorun, startup
discovery — all in one file. The JS ROM separates those responsibilities into three distinct layers,
mirroring the Unix firmware → kernel → shell split:

```text
┌──────────────────────────────────────────────────────────────────┐
│  bios.ts  (firmware / bootloader)                                │
│  • Terminal reset, boot banner                                   │
│  • require.paths = ["/rom/lib", "/rom/bin"]                      │
│  • Sets require.cache for native Java APIs (term, fs, …)         │
│  • Transfers control: require("/rom/os")                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  /rom/os/index.ts  (the OS — init / "kernel" layer)              │
│  • Detects device type (turtle / pocket / command / standard)    │
│  • Builds PATH from device type + term.isColor()                 │
│  • Sets process.env.PATH, process.env.HOME = "/"                 │
│  • Registers standard aliases (ls, cp, mv, rm, …)               │
│  • Registers tab-completion functions for all ROM programs        │
│  • Runs /rom/autorun/ files in alphabetical order                │
│  • Discovers and runs user startup scripts                        │
│    – Disk startup (if process.settings.get("shell.allow_disk_startup"))│
│    – /startup.js, /startup/, or /startup                         │
│  • Launches the default shell: require("/rom/bin/bash")           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  /rom/bin/bash.ts  (interactive shell)                           │
│  • Readline loop: prompt → parse → resolve → execute             │
│  • PATH search + alias resolution                                │
│  • Tab completion (delegated to cc/shell/completion)             │
│  • Built-ins: cd, exit, help, alias, set                         │
│  • Ctrl+T → terminate current program                            │
│  • Returns to OS when user calls exit()                          │
└──────────────────────────────────────────────────────────────────┘
```

**Directory layout** (`src/ts/` → transpiled at `/`):

```text
src/ts/
├── bios.ts                        → /bios.js   (loaded by JSMachine on __start__)
└── rom/
    ├── os/
    │   └── index.ts               → /rom/os/index.js  (the OS init layer)
    ├── bin/                       → /rom/bin/   (executables on PATH)
    │   ├── bash.ts                → interactive shell
    │   ├── ls.ts, cp.ts, …        → file-management commands
    │   ├── edit.ts                → full-screen text editor
    │   └── …                      (one file per program from JS_ROM_FEATURES.md)
    ├── lib/                       → /rom/lib/   (libraries, on require.paths)
    │   ├── colors.ts
    │   ├── textutils.ts
    │   ├── keys.ts
    │   └── cc/
    │       ├── expect.ts
    │       ├── strings.ts
    │       └── …
    └── help/                      → /rom/help/  (copied as-is, not transpiled)
```

**Key `require.paths` change**: `["/rom/lib", "/rom/bin"]` instead of the Lua `/rom/apis`.
Programs in `/rom/bin` are both runnable and requireable as libraries (same as Unix commands).

**OS environment object** (`/rom/os` exports):

```ts
{
  env: Record<string, string>,   // PATH, HOME, TERM, COMPUTER_ID, COMPUTER_LABEL
  path(): string,                // current PATH string
  setPath(p: string): void,
  alias(from: string, to: string): void,
  aliases(): Record<string, string>,
  setCompletionFunction(prog: string, fn: CompletionFn): void,
  run(program: string, ...args: string[]): boolean,
  exec(program: string, ...args: string[]): never,  // replaces current process
}
```

### 11.B — Implementation (driven by `JS_ROM_FEATURES.md` + 11.A.1 architecture)

Implement in strict dependency order. Each item is a separate file commit.

#### Tier 0 — Pure utilities (no dependencies on other ROM files)

- [ ] **11.3** `src/ts/rom/lib/colors.ts` — colour constants + pack/unpack/blit helpers
- [ ] **11.4** `src/ts/rom/lib/keys.ts` — key-name constants (integer → name map)
- [ ] **11.5** `src/ts/rom/lib/cc/expect.ts` — type-checking helpers (`expect`, `field`, `range`)
- [ ] **11.6** `src/ts/rom/lib/cc/strings.ts` — `split`, `trim`, `contains`, `ensure_width`, `wrap`
- [ ] **11.7** `src/ts/rom/lib/vector.ts` — 3D integer vector class (add, sub, mul, dot, cross, normalize, tostring)

#### Tier 1 — Terminal + formatting (depends on `term` native)

- [ ] **11.8** `src/ts/rom/lib/textutils.ts` — `serialize`/`unserialize`, `formatTime`, `pagedPrint`, `tabulate`, `urlEncode`/`urlDecode`
- [ ] **11.9** `src/ts/rom/lib/cc/pretty.ts` — pretty-printing of arbitrary JS values with colour support
- [ ] **11.10** `src/ts/rom/lib/window.ts` — virtual terminal window (redirectable sub-surface of `term`)
- [ ] **11.11** `src/ts/rom/lib/paintutils.ts` — terminal pixel drawing (lines, boxes, images, NFT images)
- [ ] **11.12** `src/ts/rom/lib/cc/image/nft.ts` — NFT image format (parse/build)

#### Tier 2 — OS layer + shell (depends on Tier 0–1)

- [ ] **11.13** `src/ts/bios.ts` — hardware init only: terminal reset, banner, `require.paths`, boot `/rom/os` — *partial: boot menu, `require.paths`, boots `/rom/os`; installs only the Node globals `process`/`console` (#34, no more `print`/`write`)*
- [ ] **11.14** `src/ts/rom/os/index.ts` — device detection, PATH, aliases, completion registration, autorun, startup discovery, launch bash — *partial: device detection + `require.paths`; aliases/autorun/startup in #1*
- [ ] **11.15** `src/ts/rom/lib/cc/shell/completion.ts` — completion handler factories (`file`, `program`, `help`, `peripheral`)
- [ ] **11.16** `src/ts/rom/bin/bash.ts` — readline loop, PATH search, alias resolution, tab-complete, built-ins (cd, exit, alias, set, help, clear, pwd) — *partial: built on `readline` (line editing, history with prefix search, tab completion, Ctrl+C), `$VAR`, cd/exit/export/unset/env, Ctrl+T, programs as jobs with `process.argv`/`process.exit` (#34); rest in #4*

#### Tier 3 — Peripheral + network libraries (depends on Tier 0–2)

- [ ] **11.17** `src/ts/rom/lib/peripheral.ts` — `wrap`, `find`, `getNames`, `isPresent`, `getType`, `call`
- [ ] **11.18** `src/ts/rom/lib/rednet.ts` — open/close, send, broadcast, receive (with timeout), host/lookup, protocol filter
- [ ] **11.19** `src/ts/rom/lib/http.ts` — `get`, `post`, `request`/`checkURL` wrappers with streaming; `websocket`
- [ ] **11.20** `src/ts/rom/lib/gps.ts` — trilateration via `rednet` + modem; `locate()` blocking call
- [ ] **11.21** `src/ts/rom/lib/disk.ts` — disk drive API wrappers

#### Tier 4 — I/O + settings (depends on Tier 0–3)

- [ ] **11.22** `src/ts/rom/lib/settings.ts` — typed key-value store backed by `/.settings` JSON file; `define`, `get`, `set`, `unset`, `load`, `save`
- [ ] **11.23** `src/ts/rom/lib/io.ts` — JS file handles (`io.open`, `io.lines`, `io.read`, `io.write`); stdout/stdin/stderr stream objects — *streams done as Node's `process.stdin/stdout/stderr` (#34); file handles are `fs`*
- [x] **11.23a** Node-style stdio (#34): `process`, `console`, `util`, `readline`, `readline/promises` in `src/ts/rom/lib` (+ `internal/tty.ts` terminal driver and job control, `internal/emitter.ts`), `.d.ts` in `src/ts/types`; ROM core modules resolved by `JSRequire`; all ROM programs and test bioses migrated from `print`/`write`
- [ ] **11.24** `src/ts/rom/lib/help.ts` — `setPath`, `path`, `lookup`, `completeTopic`; topics are `.txt` files in help path

#### Tier 5 — Built-in programs (depends on Tier 0–4)

- [ ] **11.25** File management: `ls.ts`, `cp.ts`, `mv.ts`, `rm.ts`, `mkdir.ts`, `type.ts`, `drive.ts` — *partial: `ls`, `cp`, `mv`, `rm`, `mkdir`, `cat`, `echo` in `rom/os/bin`*
- [ ] **11.26** Info/control: `id.ts`, `label.ts`, `reboot.ts`, `shutdown.ts`, `clear.ts`, `time.ts`, `about.ts` — *partial: `clear`*
- [ ] **11.27** `help.ts` (program) — page help topics from `/rom/help/`; `programs.ts` — list available commands
- [x] **11.28** `edit.ts` — full-screen text editor (MVP): load/create, cursor + scroll, insert/Enter/Backspace/Delete, paste, term_resize, Ctrl menu (Save/Exit). Established the **interactive-program model**: `main()` blocks on a `system.yield()` spin while its own `events.on('char'/'key'/'paste')` callbacks edit; `bash` suspends its own input listeners while a program runs. Follow-ups:
  - [ ] **11.28a** Syntax highlighting for `.ts`/`.js` — `term.blit` per line + a tokenizer in a shared `rom/lib/cc/syntax.ts` (keyword/string/template/number/comment/identifier → colour). Must thread a multiline carry state (block comments, template literals) from the top of the viewport down. Reused by `js.ts` (11.29).
  - [ ] **11.28b** Tab completion — `require('…')` module names (native + `require.paths`) and identifiers/keywords; reuse bash's `commonPrefix` + the `cc/shell/completion` factories (11.15).
  - [ ] **11.28c** Copy / cut / paste **selection** (shift+arrows), plus `Run`/`Print` menu items and an unsaved-changes prompt on Exit.
  - [ ] **11.28d** Mouse support (`mouse_click` to position caret, `mouse_scroll` to scroll).
  - [ ] **11.28e** Depends on Tier-0 `keys.ts` (11.4) + `colors.ts` (11.3) — replace the inlined key codes / colour numbers once those land.
- [ ] **11.29** `js.ts` — interactive JS REPL using `Function()`; print return values via `cc/pretty`; history, tab-completion
- [ ] **11.30** `monitor.ts` — run a program redirecting its terminal output to an attached monitor peripheral
- [ ] **11.31** Network programs: `wget.ts`, `pastebin.ts` (upload/download)
- [ ] **11.32** Rednet programs: `chat.ts` (send/receive messages), `repeat.ts` (wireless relay daemon)
- [ ] **11.33** Peripheral utilities: `peripherals.ts` (list attached), `redstone.ts` (inspect/set sides) — *partial: `peripherals`*
- [ ] **11.34** Turtle programs: `go.ts`, `turn.ts`, `excavate.ts`, `tunnel.ts`, `refuel.ts`, `craft.ts`, `dance.ts`, `equip.ts`, `unequip.ts`
- [ ] **11.35** Pocket programs: `equip.ts`, `unequip.ts`, `falling.ts`
- [ ] **11.36** Command-computer programs: `commands.ts`, `exec.ts`
- [ ] **11.37** Multishell + bg/fg: `src/ts/rom/bin/multishell.ts` — tabbed shell using `window`; `bg.ts` / `fg.ts` open/move tabs
- [ ] **11.38** Fun programs: `hello.ts`, `dj.ts`, `speaker.ts`, `worm.ts`, `adventure.ts`, `paint.ts`, `redirection.ts`

#### Tier 6 — Help content + validation

- [ ] **11.39** Copy `lua/rom/help/` files to `src/ts/rom/help/` (verbatim, not transpiled); update references to APIs that were renamed
- [ ] **11.40** Write `src/ts/rom/help/index.md` listing all JS programs and lib modules
- [ ] **11.41** Verify: full in-game boot → OS banner → bash prompt; each Tier 5 program runs without error
- [ ] **11.42** MOTD: copy/adapt `motd.txt`; `motd.ts` program reads it and prints on boot (called by OS layer)

- [ ] **Commit** — stage Phase 11 files; propose commit message; wait for user approval

---

## Phase 12 — Node.js-style event loop

Decouple `pendingContinuations` from the raw CC event dispatch cycle.
Currently every continuation is driven by `handleEvent()`, meaning continuations
only advance when a CC event happens to arrive. The goal is a dedicated per-tick
event loop that processes all ready work in priority order — exactly like the
Node.js event loop — so that timers fire on schedule, microtasks flush before the
next I/O phase, and no continuation starves another.

### Architecture

```text
 ┌─────────────────────────────────────────────────────────┐
 │  Per-tick event loop (runs once per CC server tick)     │
 │                                                         │
 │  Phase 1 — Timers                                       │
 │    Resume continuations whose os.sleep / startTimer     │
 │    deadline has expired (stored in a priority queue      │
 │    keyed by expiry tick).                               │
 │                                                         │
 │  Phase 2 — I/O                                          │
 │    Resume continuations whose CC event filter matched   │
 │    (turtle.forward, modem messages, task_complete…).    │
 │    Replaces the current resumePending() scan.           │
 │                                                         │
 │  Phase 3 — Microtasks / nextTick                        │
 │    Drain a nextTick queue (Promise resolution,          │
 │    queueMicrotask). Runs after each of the above        │
 │    phases, before the next phase starts.                │
 │                                                         │
 │  Phase 4 — Idle / check                                 │
 │    Run setImmediate-style deferred callbacks.           │
 │    Last phase; feeds back into Phase 1 next tick.       │
 └─────────────────────────────────────────────────────────┘
```

### Storage model

Each continuation is bucketed by its phase rather than kept in a single flat list:

| Bucket | Key | Contents |
| --- | --- | --- |
| `timerQueue` | expiry tick (long) | `PriorityQueue<TimerContinuation>` |
| `ioPending` | event filter string | `Map<String, List<ContinuationPending>>` |
| `microtaskQueue` | — | `ArrayDeque<Runnable>` (JS callbacks) |
| `checkQueue` | — | `ArrayDeque<ContinuationPending>` |

### Tasks

- [x] **12.1** Introduce `EventLoop` class in `engine/` with the four-phase structure above; keep `JSMachine` as the owner
- [x] **12.2** Replace the `pendingContinuations` flat list with bucketed storage (`timerMap`, `ioMap`, `microtaskQueue`, `checkMap`)
- [x] **12.3** Move timer logic out of `OSAPI.doSleep()` / `waitForTimer()` into `EventLoop.SleepState` + `timerMap`; `os.sleep(n)` is now a `BaseFunction` in `JSMachine` that captures a continuation with `SleepState(timerId)` and enqueues directly into `timerMap`; `OSAPI.startTimerForSleep(ticks)` is the scheduling helper
- [x] **12.4** Move `resumePending()` logic into `EventLoop.drainIO(cx, scope, eventName, fullArgs)`; called from `handleEvent()` as Phase 2
- [x] **12.5** Add `EventLoop.drainMicrotasks()` — called after Phase 1 and Phase 2; drains recursively so microtasks queued by microtasks also run before the next I/O phase
- [x] **12.6** Expose `queueMicrotask(fn)` as a JS global backed by the microtask queue
- [x] **12.7** Expose `setImmediate(fn)` / `clearImmediate(handle)` as JS globals backed by `checkMap`
- [x] **12.8** Verify: `os.sleep(0.05)` resumes exactly 1 tick later; multiple concurrent sleeps each fire at the right tick; `queueMicrotask` runs before the next I/O phase — *done: `JSEventLoopTimingTest` (#13)*
- [x] **12.9** Update `JS_MIGRATION.md` cross-cutting reference table with event loop model

- [ ] **Commit** — stage Phase 12 files; propose commit message; wait for user approval

---

## Cross-cutting reference

| Concern | Approach |
| --- | --- |
| Tight loop | `cx.setInstructionObserverThreshold(N)` + `CCContextFactory.observeInstructionCount()` |
| Hard abort | `throw new EvaluatorException("hard abort")` from safepoint |
| Soft abort | `throw new EvaluatorException(ABORT_MESSAGE)` from safepoint |
| Pause/preemption | Spin-wait inside `observeInstructionCount()` until `isPaused()` clears |
| Main-thread tasks | Rhino continuation captured in JS; CC queues non-blocking task; `task_complete` event resumes continuation |
| Blocking during pending | Other `events.on()` events dispatch normally while continuation is stored |
| Rhino mode | `optimizationLevel(-1)` interpreter — pure Java, no class generation, continuations work |
| Security | `cx.setClassShutter(name -> false)`, strip `Packages`/`java` globals |
| Globals | `require` only — all APIs (`process`, `events`, `turtle`, `term`, `fs`, …) must be loaded with `require()` |
| Event model | `var events = require('events'); events.on(event, cb)` — synchronous callbacks in `handleEvent()` |
| Sync ops | `turtle.dig()` returns value directly (`{ success, reason? }`); blocking is the default |
| Async ops (#35) | `require('turtle/promises').dig()` returns a `Promise`; promise jobs run in Phase 3; `async.run` / `async.unwrap` bridge the styles; TS `async` compiles to generators + the native `babel-helpers` (see `JS_API_REDESIGN.md`, "Async model") |
| Modules | `require(id)`: checks native registry first, then CC filesystem; `require.paths = ["/rom/lib", "/rom/bin"]` |
| Native modules | Java APIs registered by name in `JSRequire.nativeModules`; CC `os` split into `process` + `events` modules; engine internals (emitter, scheduler) exposed via `require('events')` through `EventsAPI` |
| Continuation routing | `MethodResult.Bucket` enum encodes the event-loop phase: `TIMER` → Phase 1 timer map; `IO` → Phase 2 I/O map; `YIELD` → Phase 4 yield queue; `null` → return immediately (no continuation captured) |
| Event loop — Phase 1 Timers | `EventLoop.drainTimers()` — resumes `os.sleep()` continuations keyed by CC timer ID; O(1) lookup via `timerMap`. `EventLoop.drainJsTimers()` — runs due `setTimeout`/`setInterval` callbacks (`JSTimers`) in due-time order |
| Event loop — Phase 2 I/O | `EventLoop.drainIO()` — resumes continuations matched by event-filter string (or null wildcard); callback chain re-bucketed if not yet complete |
| Event loop — Phase 3 Microtasks | `EventLoop.drainMicrotasks()` — drains `queueMicrotask()` callbacks after every other phase; new microtasks enqueued during draining also run this cycle |
| Event loop — Phase 4 Yields | `EventLoop.drainYields()` — resumes `os.yield()` continuations with `undefined`; snapshot-clear so re-yields land in the next tick |
| Event loop — Phase 5 Check | `EventLoop.drainCheck()` — runs `setImmediate()` callbacks registered before the current cycle; cleared callbacks carry over to next tick |
| `os.sleep(n)` | `OSAPI.doSleep` calls `apiEnvironment.startTimer(n)`, returns `MethodResult.timer(id)` → captured continuation stored in `timerMap[id]`; resumed by Phase 1 when CC fires `timer` event |
| `os.yield()` | `OSAPI.doYield` queues a `cc:yield` event, returns `MethodResult.yield()` → continuation stored in `pendingYields`; resumed by Phase 4 on the same tick |
| `queueMicrotask(fn)` | `EventsAPI.queueMicrotask` → `EventLoop.scheduleMicrotask(fn)`; runs in Phase 3 after the current phase completes |
| `setImmediate(fn)` / `clearImmediate(id)` | `EventsAPI.setImmediate/clearImmediate` → `EventLoop.scheduleImmediate/cancelImmediate`; runs in Phase 5 (check phase) |

---

## Phase 13 — Unified event bus

Before this phase there was only one way for an event to reach `events.on` listeners:

```text
Queued — any thread, CC-originated events (Java APIs, peripherals, timers)
  computer.queueEvent(new SomeEvent(…))            (an @Event record)
    → CC computer event queue (cross-tick, cross-thread safe)
      → later: JSMachine.handleEvent(name, args)
        → wakes blocked calls waiting for it (EventLoop Phase 2), then
        → EventLoop.emit(…): each listener entered from the event loop (may block)
```

Java code already running inside the machine (a script method) had no way to deliver an event synchronously, and
JS had no `events.emit` at all.

### Result

`JSEventEmitter` is the single dispatch point, with two delivery modes:

```text
Queued (unchanged) — computer.queueEvent(record), from any thread
  → next handleEvent → drainIO + EventLoop.emit (listeners may block)

Synchronous — from inside the machine's JS execution, before the call returns
  Java:  JSEventEmitter.current().fireNow(record)          ← @Event record
    → EventLoop.dispatchNow(…): each listener called from Java (cannot block)
  JS:    require('events').emit('custom', ...args)         ← boolean "had listeners"
    → JS emit (JSEventEmitter.installEmit) loops over EventLoop.emitPlan(event):
        own / ancestor-thread listener → called from JS, may block (blocks the caller of emit)
        unrelated-thread listener      → ForeignListener: run as its owner from Java (cannot block)
```

- **`JSEventEmitter.fireNow(Record)`** (and `fireNow(Context, Scriptable, Record)`) — record-based like
  `queueEvent(Record)`; arguments are converted with `JSValues.toJs`. `JSEventEmitter.current()` finds the emitter of
  the machine executing on this thread (Context thread-local, like `JSScheduler`) and throws `IllegalStateException`
  anywhere else, so cross-thread callers cannot use it by mistake. It only reaches `events.on` listeners: blocked
  calls waiting for the event (`MethodResult.pullEvent`, `TaskCompletion`) are **not** woken — those need
  `queueEvent`.
- **`events.emit(event, ...args)`** — Node `EventEmitter.emit` semantics: synchronous, listeners in registration
  order (`once` listeners removed first), the arguments passed unchanged (same objects), returns whether there were
  listeners. `events/promises.emit` is the generated promise flavour: it emits synchronously too and returns an
  already-settled `Promise<boolean>` (a listener error or a reserved name rejects it).
- **Native event names are reserved.** `events.emit` throws an `Error` with `code: 'ERR_RESERVED_EVENT'` for every
  name registered through `Events.register` — all `@Event` records (`CoreEvents`, `KeyEvent`, `CharEvent`,
  `RedstoneEvent` from `JSEventEmitter`'s static initializer; `PeripheralEvents` from `ModRegistry.register`) plus the
  engine-internal `__start__` and `cc:js-tick`. Otherwise any program could fake input (`key`, `char`, `paste`, mouse
  events) that the shell or another program acts on, fake `terminate`, or emit `timer` / `task_complete` /
  `modem_message` / `http_success` with forged arguments that other programs' listeners trust. Every other name is
  allowed; addon mods register their own `@Event` records the same way. (Emitting a native name could not wake a
  blocked call anyway, since `emit` does not go through the I/O phase — it would only mislead listeners.)
- **`emit` is JS, so listeners can block.** Rhino can only capture a continuation across interpreted frames. The
  blocking module's `emit` is therefore a small JS function (`JSEventEmitter.EMIT_JS`, installed on the `events`
  module object by `installEmit`; no new global, the sandbox allow-list is unchanged). It asks the native, never
  blocking `plan(event)` (`EventLoop.emitPlan`) for the listeners — reserved-name check, `once` listeners removed,
  registration order kept — and calls them itself with `fn.apply` (which stays in the interpreter). Listeners are
  split by ownership:
  - **Own / ancestor listeners** (owned by the calling thread or one of its ancestors — always the case for root
    listeners) are called directly, as part of the caller's strand. They may block (`turtle.dig()`, `sleep`, …),
    which blocks the caller: `emit` returns once all listeners have finished, as Node's `emit` does for synchronous
    listeners. This is safe for ancestor-owned listeners because it is the caller's own lineage: the ancestor is
    waiting for the caller (or runs it in the background), and killing the ancestor kills the caller too. The
    difference to normal dispatch: work the listener starts (`events.on`, `parallel.spawn`, …) belongs to the caller
    rather than to the ancestor — inherited by the ancestor when the caller returns, discarded if the caller is
    stopped. Ctrl+T reaches a listener blocked in a foreground caller like any blocking call of the caller; the
    `Terminated` error propagates out of `emit`.
  - **Unrelated-thread listeners** are wrapped in a `ForeignListener`, which runs them as their owner from Java
    (`EventLoop.callAs`), exactly like `fireNow`: they cannot block (clear error), and an error fails their owner.
  - If `emit` itself is called where no continuation can be captured — inside `Array.prototype.forEach` & co. (see
    #38), generators or promise jobs — a blocking own listener gets the usual clear error.
- **`fireNow` and `events/promises.emit`** call every listener from Java (`EventLoop.dispatchNow`), so none can
  block: the blocking error says "… cannot be used inside async code or callbacks run by native code (such as
  Array.prototype.forEach, or a listener of another thread called by events.emit) — use require('x/promises')
  instead". The way out is `setImmediate` or a `/promises` module. `events/promises.emit` deliberately stays simple:
  synchronous, settled promise; it does not wait for (blocking or async) listeners.
- **Thread ownership** — every listener of another thread runs as that thread (`EventLoop.callAs`), so work it starts
  belongs to it; listeners of stopped threads are skipped.
- **Errors** — an error in a listener owned by the calling thread or one of its ancestors is thrown from `emit` /
  `fireNow`, skipping the remaining listeners, as in Node; failing the owner would kill the caller anyway, so the
  caller gets the chance to catch it. An error in a listener of an unrelated thread fails that thread exactly as in
  normal dispatch, and the remaining listeners still run.
- **Types** — `EventMap` (generated, native events) plus an empty, augmentable `CustomEventMap` (emitted by the
  doclet next to it). `emit` is typed `emit<E extends keyof CustomEventMap>(event: E, ...args: CustomEventMap[E])`
  plus `emit<E extends string>(event: E extends keyof EventMap | keyof CustomEventMap ? never : E, ...args: any[])`,
  so emitting a native name is a compile error, declared custom events are checked, and other names are free-form.
  `on` / `once` / `off` get a `CustomEventMap` overload as well.

### `queueEvent` audit (13.4)

Every call site runs on a thread other than the target machine's JS execution (or is a generic pass-through whose
caller is unknown), so **all stay queued** — none was migrated to `fireNow`. The queue is also what wakes blocked
calls waiting for an event (Phase 1/2), which `fireNow` does not do.

| Call site | Event(s) | Runs on | Verdict |
|---|---|---|---|
| `Environment` timer tick | `timer` | computer tick (server thread) | cross-thread: must stay (also wakes `sleep`, Phase 1) |
| `SystemAPI` alarm tick | `alarm` | server tick | cross-thread: must stay |
| `Computer` redstone tick | `redstone` | server tick | cross-thread: must stay |
| `PeripheralAPI.onPeripheralChanged` | `peripheral`, `peripheral_detach` | server tick (peripheral change) | cross-thread: must stay |
| `WiredModemPeripheral` remote attach/detach | `peripheral`, `peripheral_detach` | server thread (wired network) | cross-thread: must stay |
| `JSContext` main-thread task | `task_complete` | server thread (main-thread task) | cross-thread: must stay (wakes the `TaskCallback`, Phase 2) |
| `TurtleBrain` command completion | `task_complete` | turtle update tick (server thread) | cross-thread: must stay (wakes `TaskCompletion.await`) |
| `HttpRequest`, `CheckUrl`, `Websocket`, `WebsocketHandler` | `http_*`, `websocket_*` | Netty I/O threads | cross-thread: must stay |
| `EventComputerInput` | `key`, `key_up`, `char`, `paste`, `mouse_*` | server network thread | cross-thread: must stay |
| `ComputerActionServerMessage` | `terminate` | server network thread | cross-thread: must stay |
| `ServerInputState` | `file_transfer` | server network thread | cross-thread: must stay |
| standalone `InputState` | `file_transfer`, `terminate` | emulator UI thread | cross-thread: must stay (now queues `CoreEvents` records instead of raw names) |
| `ModemPeripheral` receive | `modem_message` | the *sending* computer's thread / server thread | cross-thread (another machine): must stay |
| `MonitorBlockEntity` | `monitor_resize`, `monitor_touch` | server tick / player interaction | cross-thread: must stay |
| `DiskDriveBlockEntity` | `disk`, `disk_eject` | server thread | cross-thread: must stay |
| `SpeakerPeripheral` | `speaker_audio_empty` | server tick | cross-thread: must stay |
| `RedstoneRelayPeripheral` | `redstone` | server tick | cross-thread: must stay |
| `TurtleBlockEntity` | `turtle_inventory` | server thread (inventory change) | cross-thread: must stay |
| `CommandComputerCraft` (`/computercraft queue`) | `computer_command` | server thread (command) | cross-thread: must stay |
| `ComputerExecutor` self-tick | `cc:js-tick` | any thread (executor wake-up) | must stay: it *is* the mechanism that schedules the next tick |
| `ComputerAccess`, `PeripheralAPI.PeripheralWrapper`, `WiredModemPeripheral.RemotePeripheralWrapper`, `AttachedComputerSet` | any (addon `IComputerAccess.queueEvent`) | unknown (usually server thread) | must stay: generic API; Java code inside a script method can use `JSEventEmitter.current().fireNow(record)` |
| `TestAPI` / `ManagedComputers` (testMod), `KotlinMachine` / `ScriptTaskRunner` (test fixtures), `ComputerTrackingPeripheral` (example) | test / example events | test harness / server thread | must stay (test-only / example) |
| `EventLoop.checkRejections` | `unhandled_rejection` | inside the machine | already dispatched directly (`EventLoop.emit`), never queued |
| `JSMachine.handleEvent` (boot) | `__start__` | inside the machine | already dispatched directly, never queued |

`projects/web` (TeaVM emulator, disabled, #17) has its own copies of the HTTP and speaker sites; same verdict.

- [x] **13.1** Remove the redundant `apiEnvironment.queueEvent("cc:yield", …)` from `OSAPI.doYield()` — the `MethodResult.YIELD` bucket already handles the yield without needing a CC event — *done: `SystemAPI.doYield` only returns `MethodResult.yield()`*
- [x] **13.2** `JSEventEmitter.fireNow(Record)` / `fireNow(Context, Scriptable, Record)` + `JSEventEmitter.current()` — synchronous, record-based delivery for Java callers inside the JS execution context (`EventLoop.dispatchNow`)
- [x] **13.3** `events.emit(event, ...args)` (and `events/promises.emit`) in `EventsAPI`: Node semantics, implemented in JS so own/ancestor listeners may block, native names rejected (`Events.register` / `Events.isNative`, `ERR_RESERVED_EVENT`), typed through `CustomEventMap`
- [x] **13.4** Audit all `queueEvent()` call sites — see the table above; all stay queued
- [x] **13.5** `JSEventEmitTest`: synchronous delivery within the call (`fireNow` from a script method, `emit`) vs. queued delivery on the next `handleEvent`, return value, reserved names, argument identity, listener ownership and stopped threads, error propagation, blocking own and ancestor listeners (I/O wait, timer, Ctrl+T), unrelated-thread listeners and emit inside forEach cannot block, registration order across threads, the promise flavour, nested emit from native callbacks; `EventsTest` covers the registry
- [ ] **Commit** — stage Phase 13 files; propose commit message; wait for user approval

---

## Phase 14 — Unify turtle commands with the task-completion continuation

Turtle functions (`turtle.forward()`, `dig()`, `place()`, …) resume through a **bespoke
event** instead of the normal continuation buckets. They re-implement, in parallel, the
exact pattern the standard main-thread-task path already provides:

```text
Standard blocking call (everything except turtles):
  IContext.executeMainThreadTask(task)
    → TaskCallback: MethodResult.pullEvent("task_complete", cb)   ← IO bucket, keyed by taskId
    → scheduler runs task, queueEvent("task_complete", [taskId, ok, result])
    → EventLoop Phase 2 (drainIO) resumes the continuation with `result`

Turtle call (the odd one out):
  TurtleBrain.executeCommand(command)
    → CommandCallback: MethodResult.pullEvent("turtle_response", cb)  ← IO bucket, but custom event
    → command is queued on the turtle's own commandQueue
    → turtle's update tick runs it, queueEvent("turtle_response", [callbackID, ok, …results])
    → CommandCallback.resume re-matches callbackID, returns the (ok, …) tuple
```

`CommandCallback` ([TurtleBrain.java](projects/common/src/main/java/dan200/computercraft/shared/turtle/core/TurtleBrain.java))
is a near-duplicate of `TaskCallback`
([core-api](projects/core-api/src/main/java/dan200/computercraft/api/scripting/TaskCallback.java)):
both park an IO-bucket `pullEvent` keyed by an id. The only real difference is that a turtle
command does not complete on the main-thread scheduler — it completes on the **turtle's own
update tick** (after any movement animation). So it cannot literally call
`issueMainThreadTask` (which runs the task and fires `task_complete` immediately), and it grew
its own event + id scheme instead.

### Goal

Fold turtle completion into the standard `task_complete` continuation: one IO-bucket path, one
id space (`computer.getUniqueTaskId()`), no `turtle_response` event and no `CommandCallback`.
The turtle keeps its `commandQueue` (per-tick serialisation + animation gating are inherent);
only the *completion signalling* changes.

```text
Unified turtle call:
  TurtleBrain.executeCommand(command)
    → taskId = computer.getUniqueTaskId()
    → commandQueue.add({ taskId, command })
    → return MethodResult.pullEvent("task_complete", resume-by-taskId)   ← same bucket as tasks
    → turtle update tick: result = command.execute(this)
        → queueEvent("task_complete", [taskId, true, shapedValue])
    → EventLoop Phase 2 resumes the continuation with `shapedValue`
```

### Implementation approach

- **`TurtleBrain.executeCommand`** — allocate `computer.getUniqueTaskId()`, enqueue `{taskId,
  command}` on `commandQueue`, return a `task_complete` pull keyed by `taskId` (reuse a small
  shared helper rather than a turtle-specific callback class — see below).
- **`TurtleBrain.dispatchCommand`** — replace `queueEvent("turtle_response", [callbackID, …])`
  with `queueEvent("task_complete", [taskId, true, shapedValue])`.
- **Result shaping** — the single resumed value is built per command/method (`Result` for
  can-fail actions, `boolean` for predicates like `detect`/`compare`, the data table for
  `inspect`/`getItemDetail`). This is the same shaping decision tracked for the `Result`
  migration; it lands here at the completion site.
- **Delete** `CommandCallback`, the `turtle_response` event, and the `[callbackID, success,
  …results]` packing/re-matching.
- **Shared helper** — optionally add `MethodResult awaitTaskCompletion(long taskId)` next to
  `TaskCallback` (it is `TaskCallback` minus `issueMainThreadTask`, for an externally-completed
  id), so the turtle and any future tick-driven API reuse one resume/match implementation.

### Important nuance — completion vs. action success

Standard `task_complete` semantics **throw** on `[taskId, false, message]` (a real Java/script
error). A turtle *action failure* ("Cannot break this block") is a **value**, not an error.
So the turtle always emits `[taskId, true, shapedValue]` — "the tick ran the command" — and the
action's success/failure lives inside `shapedValue` (the `Result`). Only a genuine exception
thrown from `command.execute` should emit `[taskId, false, message]` and surface as a thrown
error. This split must be explicit in `dispatchCommand`.

Behaviour is otherwise unchanged: the continuation stays parked across animation ticks, and the
computer keeps processing other events meanwhile — exactly as today, just on the unified path.

- [x] **14.1** Add `TaskCompletion.await(long taskId)` helper alongside `TaskCallback` (park a `task_complete` IO pull for an externally-completed id; resume with the carried value, rethrow only on `[id, false, message]`)
- [x] **14.2** `TurtleBrain.executeCommand` — allocate `ServerComputer.getUniqueTaskId()` (delegates to `Computer`, now public), enqueue `{taskId, command}`, return `TaskCompletion.await(taskId)`
- [x] **14.3** `TurtleBrain.dispatchCommand` — emit `task_complete` `[taskId, true, value]`; emit `[taskId, false, message]` only for a thrown `command.execute` exception (also fixes the previously-hung continuation on such a throw)
- [x] **14.4** Move result shaping (Result / boolean / data) to the completion site — *done in `0497a0e22` (queued turtle commands return `Result`)*
- [x] **14.5** Delete `CommandCallback`, the `turtle_response` event, the `commandsIssued` counter, and its `callbackID` plumbing (`TurtleCommandQueueEntry.callbackID:int` → `taskId:long`); refresh the `ITurtleAccess.executeCommand` javadoc
- [x] **14.6** Verify at runtime: `turtle.forward()` halts and resumes via the standard continuation; multi-tick movement still lets other events dispatch — *covered by the `Turtle_Test` gametests (`Move_task_complete`, `Move_dispatches_events`, `Command_error`, `Terminate_command`, `Energy_*`)*
- [ ] **Commit** — stage Phase 14 files; propose commit message; wait for user approval

---

## Phase 15 — ROM energy convenience helpers

`turtle.transferEnergy`/`absorbEnergy` are deliberately one-shot, single-tick primitives (return what
moved this tick, bounded by the source/sink's per-tick rate). The common "drain it fully / fill to N"
case needs a multi-tick loop; rather than baking blocking semantics into the Java primitive, ship it as
a thin TS helper in the turtle ROM library, built on the primitive + `sleep`:

```ts
// loops until `amount` moved or no further progress is possible (source dry / full / rate 0)
function absorbUntil(side: string, amount: number): number { /* loop absorbEnergy + sleep, stop on 0 */ }
function transferUntil(side: string, amount: number): number { /* loop transferEnergy + sleep, stop on 0 */ }
```

- [ ] **15.1** Add `absorbUntil`/`transferUntil` (and maybe `chargeToFull`/`drainEmpty`) helpers to the turtle ROM library
- [ ] **15.2** Stop on `=== 0` (no progress) so they never hang when the neighbour can't supply/accept
- [ ] **Commit** — stage Phase 15 files; propose commit message; wait for user approval

---

## Since the original plan (tracked as GitHub issues)

Work done after this plan was written, mostly from the code review in October 2026 (see the issues for details):

- **Engine:** catchable errors from failed blocking calls (`JSCallShim`, #23); cycle-safe Java⇄JS conversion and array
  round-trips (#20, #26); returned Java objects with script methods are wrapped (`JSObjects`); resource limits
  from the Rhino fork (#19, #37): stack depth, string length (every string, incl. `+`), `ArrayBuffer` size and `apply`
  argument count throw catchable errors (configurable), and native array loops reach the abort safepoint; memory that
  a script fills gradually is only bounded by the timeout and the out-of-memory net; uniform abort mapping
  (`JSAbort`, #30); `initSafeStandardObjects` + globals allow-list, no `Continuation`/`Script`/`With`/`Call` (#22).
- **Modules / loader:** module cached before execution (cycles, #28); `require.uncached` / `require.resolve`, bash runs
  programs uncached (#24); `getModuleName()` APIs are registered; `IFunction` return values are callable.
- **Concurrency:** native `parallel` with real green threads and cancellation (`JSParallel`/`JSThread`/`JSTaskGroup`,
  #29); Ctrl+T terminates the foreground program (#25). No public `pullEvent`/`queueEvent` (decision in #29).
- **APIs:** Node-compatible `fs` with Node error codes, callbacks via the event loop (#27); `transferEnergy` /
  `absorbEnergy` exploit fixed (#21); alarms (#31).
- **Async model (#35):** Rhino promise jobs drained in the microtask phase; engine-generated
  `require('<module>/promises')` modules (with `.d.ts` from tsdoclet); `require('async')` (`run`, `unwrap`) and a
  native `tslib`, so TS `async` functions, async generators and `for await` work (since #49 compiled by Babel to
  generators driven by the `babel-helpers` module; `tslib` stays for code compiled elsewhere); blocking
  calls inside async code and native callbacks throw a clear error before running; promise reactions owned by the
  registering thread (`JSPromises`, `Waiter`); unhandled rejections fail the owning program (Node ≥ 15) or reach the
  `unhandled_rejection` event; promise-flavour types for every script object.
- **Events (#12 follow-up):** all events are queued through their `@Event` records (`queueEvent(Record)`), so
  `EventMap` cannot drift from what is queued; `computer_command` added.
- **Stdio (#34):** `print`/`write` globals replaced by Node's `process` and `console` (installed by the bios);
  `util`, `readline`, `readline/promises` as ROM core modules (resolved before `require.paths`, `node:` prefix);
  terminal driver with VT/ANSI output and cooked/raw stdin whose listeners belong to the calling thread; bash on
  `readline`, programs run as jobs (fresh stdin, argv, cwd restore, alive while reading stdin, `process.exit`).
- **Planned:** native array loops ignoring aborts (#37); compatibility layer for CC: Tweaked addons (#33).

