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

- [ ] **1.1** Add Rhino to `gradle/libs.versions.toml`:
  - `[versions]` entry: `rhino = "1.9.1"`
  - `[libraries]` entry: `rhino = { module = "org.mozilla:rhino", version.ref = "rhino" }`
- [ ] **1.2** Replace GraalJS `implementation` dependency in `projects/core/build.gradle.kts` with `implementation(libs.rhino)`; keep Cobalt for now
- [ ] **1.3** Add `public static int jsInstructionThreshold = 10_000;` to `CoreConfig.java`
- [ ] **1.4** Smoke-check: `./gradlew :core:compileJava` passes with no errors
- [ ] **Commit** — stage Phase 1 files; propose commit message; wait for user approval

---

## Phase 1.5 — TypeScript build pipeline

Set up the transpile-on-build pipeline before writing any bios or ROM files.
All JS authored for the CC runtime lives under `projects/core/src/ts/` and is never
committed as raw `.js` — Gradle emits the `.js` output into the resource tree.

- [ ] **1.5.1** Add `projects/core/src/ts/tsconfig.json`:
  `module: commonjs`, `target: es2017`, `strict`, `noEmitOnError` — emits CommonJS `require()` calls, matching the Rhino runtime
- [ ] **1.5.2** Wire transpile into the `:core` build reusing `NpxExecToDir` task; `tsc` outputs into `build/generated/js`
- [ ] **1.5.3** Feed generated dir into `processResources` under `data/computercraft/js/`
- [ ] **1.5.4** Smoke-check: `./gradlew :core:processResources` succeeds (empty `src/ts/` is fine at this point)
- [ ] **Commit** — stage Phase 1.5 files; propose commit message; wait for user approval

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
- [ ] **2.4** Create `projects/core/src/ts/bios.ts` — minimal stub (transpiles to `data/computercraft/js/bios.js` at build time):

  ```ts
  const term = require('term');
  term.write("JS bios loaded");
  ```

- [ ] **2.5** In `ComputerExecutor.createLuaMachine()` change the resource path from `"lua/bios.lua"` to `"js/bios.js"` (the transpiled output), and pass `JSContext` instead of `LuaContext`
- [ ] **2.6** Verify: `JSMachineTest` (3 tests) — boot returns OK, `print()` runs without error, subsequent events return OK
- [ ] **Commit** — stage Phase 2 files; propose commit message; wait for user approval

---

## Phase 3 — CommonJS `require()` module resolver

- [ ] **3.1** `JSRequire.java` — `BaseFunction` implementing CommonJS `require(id)`:
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
- [ ] **3.2** `JSMachine` creates a `JSRequire` instance, exposes it as the **sole global** (`scope.put("require", scope, jsRequire)`); sets `require.paths = ["/rom/apis"]`; sets `require.cache = {}`; Java APIs are pre-registered via `jsRequire.registerNative(name, obj)` (see Phase 6.6)
- [ ] **3.3** `bios.ts` `__start__` handler does `require("/startup")` (loads `/startup.js` if present); silently ignores `MODULE_NOT_FOUND` error
- [ ] **Commit** — stage Phase 3 files; propose commit message; wait for user approval

---

## Phase 4 — Tight loop safepoint (observeInstructionCount)

- [ ] **4.1** Subclass `ContextFactory` as `CCContextFactory` in `JSMachine`:
  - Override `observeInstructionCount(Context cx, int instructionCount)`:
    - `isDisposed || timeout.isHardAborted()` → `throw new EvaluatorException("hard abort")` (terminates script)
    - `timeout.isSoftAborted()` → `throw new EvaluatorException(ABORT_MESSAGE)`
    - `timeout.isPaused()` → spin-wait with `LockSupport.parkNanos(1ms)` (blocks this call; Rhino will retry)
    - Normal → return (threshold resets automatically, execution continues)
  - Register via `ContextFactory.initGlobal(new CCContextFactory())`
- [ ] **4.2** In `handleEvent()` / `mapException()`: catch `EvaluatorException` / `RhinoException`:
  - Message equals hard-abort sentinel → `MachineResult.TIMEOUT`
  - Message equals `ABORT_MESSAGE` → `error(ABORT_MESSAGE)`
  - Other → `error(message)` + close
- [ ] **4.3** `onTimeoutChanged()` listener calls `cx.observeInstructionCount(cx, 0)` on hard abort as a wake signal — the safepoint will then throw the hard abort exception on the next instruction check
- [ ] **Commit** — stage Phase 4 files; propose commit message; wait for user approval

---

## Phase 5 — EventEmitter bridge

The listener registry is implemented entirely in Java — no JS eval, no embedded string, no
resource file. This avoids bridging overhead and keeps the event infrastructure as a plain Java
object with a clear lifecycle tied to `JSMachine`.

- [ ] **5.1** Create `JSEventEmitter.java`:
  - Inner record `ListenerEntry(Callable fn, boolean once)`
  - Field: `Map<String, List<ListenerEntry>> listeners = new HashMap<>()`
  - `void on(String event, Callable fn)` — appends `ListenerEntry(fn, false)`
  - `void once(String event, Callable fn)` — appends `ListenerEntry(fn, true)`
  - `void off(String event, Callable fn)` — removes entries whose `fn` matches
  - `void emit(Context cx, Scriptable scope, String event, Object[] jsArgs)` — snapshots the list, removes `once` entries, calls each `fn.call(cx, scope, scope, jsArgs)`
  - `int listenerCount(String event)` — returns list size
- [ ] **5.2** Do **not** inject anything as a global. Instead, register a native `events` module (see Phase 3) that exposes the emitter. `JSMachine` holds `JSEventEmitter emitter` as a field; `require('events')` returns a `NativeObject` wrapping `emitter.on/once/off/listenerCount` as `BaseFunction` instances, plus `emit`/`queueEvent` and the CC timer/alarm methods (`startTimer`, `cancelTimer`, `setAlarm`, `cancelAlarm`). The remaining CC `os` methods (shutdown, reboot, label, clock, in-game time/day/epoch) are registered as a separate `process` module. See [JS_API_REDESIGN.md](JS_API_REDESIGN.md) for the split.
- [ ] **5.3** `handleEvent(String name, Object[] args)`:
  - First call (`!started`) → `started = true` → eval bios.js resource → `emitter.emit(cx, scope, "__start__", new Object[0])`
  - Subsequent calls → convert `args` via `toJsValue()` → `emitter.emit(cx, scope, name, jsArgs)`
  - `toJsValue()` handles: null → `null`; Boolean/Number/String → wrap; byte[]/ByteBuffer → JS array; Map/Collection → `NativeObject`/`NativeArray`; recursive, cycle-safe
- [ ] **5.4** `handleEvent` returns `MachineResult.OK` immediately when `name` is null
- [ ] **Commit** — stage Phase 5 files; propose commit message; wait for user approval

---

## Phase 6 — Continuation-based blocking API bridge

This is the heart of the event loop. Instead of blocking the computer thread inside
`executeMainThreadTask()`, we capture a Rhino continuation and return immediately.
The CC scheduler remains free to process other events while the main-thread task runs.

- [ ] **6.1** Create `JSValues.java` — bidirectional Java ↔ JS value converter
  - `toJS(Scriptable scope, Object java)` → handles null, Number, Boolean, String, byte[], Map, Collection, Object[], ILuaFunction, IDynamicLuaObject (recursive, cycle-safe)
  - `toJava(Object v)` → unwrap NativeObject/NativeArray/primitives back to Java types
- [ ] **6.2** `JSArguments.java` — `IArguments` backed by `Object[]` (Rhino values); `get()` uses `JSValues.toJava()`; `drop()` via offset
- [ ] **6.3** `JSMethodBridge.java` — `BaseFunction` wrapping `LuaMethod`:
  - `call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args)`:
    - Wrap args as `JSArguments`
    - If method requires `ILuaContext` (i.e. calls `executeMainThreadTask`): capture continuation via `throw cx.captureContinuation()` after queuing; see **6.4**
    - No-callback methods: call method, convert result with `JSValues.toJS()`, return directly
- [ ] **6.4** Continuation flow in `JSContext.executeMainThreadTask()`:
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
- [ ] **6.5** `JSAPIBuilder.java` — enumerates methods via `forEachMethod`, wraps each as `JSMethodBridge`, returns `NativeObject` (scriptable map)
- [ ] **6.6** `JSMachine` constructor registers every CC API as a **native module** in `JSRequire` (not as a global):
  - `jsRequire.registerNative(api.getModuleName(), JSAPIBuilder.build(api))` for each API in `env.apis()`
  - Split the CC `os` API: the EventEmitter `on/once/off` + `emit`/timers/alarms become the `events` module; the rest (shutdown, reboot, label, clock, in-game time) become the `process` module
  - The only global set on `scope` is `require` itself (plus the global timer functions `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` and `sleep`)
- [ ] **6.7** `bios.ts` updated — loads `term` via `require`; `print` is a plain TS helper defined in `bios.ts`. Terminal coordinates are **0-based** and `getCursorPos()` returns an object:

  ```ts
  const term = require('term');
  function print(text: string): void { term.write(String(text)); const { y } = term.getCursorPos(); term.setCursorPos(0, y + 1); }
  ```

- [ ] **Commit** — stage Phase 6 files; propose commit message; wait for user approval

---

## Phase 7 — Sandboxing & security

- [ ] **7.1** Tighten Rhino access in `JSMachine` constructor:
  - `cx.setClassShutter(className -> false)` — blocks `Packages.*`, `java.*`, `importClass()`, etc.
  - Remove `Packages`, `java`, `javax`, `org`, `com`, `edu`, `net` from top-level scope: `ScriptableObject.deleteProperty(scope, "Packages")` etc.
  - Override `CCContextFactory.makeScope()` or post-init cleanup to strip `JavaImporter`
  - `cx.setOptimizationLevel(-1)` already set — no class generation, no reflection bypass via bytecode
- [ ] **7.2** Verify `java.lang.Runtime.getRuntime().exec("ls")` throws from JS
- [ ] **7.3** Verify API objects only expose wrapped `BaseFunction` methods, not arbitrary Java fields
- [ ] **Commit** — stage Phase 7 files; propose commit message; wait for user approval

---

## Phase 7.5 — ROM filesystem wiring

Wire the ROM directory into the CC filesystem so Phase 11 programs are accessible at runtime.
Do **not** write any `.ts` files under `src/ts/rom/` here — all ROM content is authored in Phase 11
after `JS_ROM_FEATURES.md` defines the feature contracts.

- [ ] **7.5.1** Create `projects/core/src/ts/rom/` (empty placeholder; populated in Phase 11)
- [ ] **7.5.2** Update `ComputerExecutor` to mount `js/rom` at `/rom` in the CC filesystem
- [ ] **7.5.3** Update `bios.ts` to attempt `require("/startup")` (silently ignores `MODULE_NOT_FOUND`) then boot `/rom/programs/shell.js`
- [ ] **Commit** — stage Phase 7.5 files; propose commit message; wait for user approval

---

## Phase 8 — Testing

- [ ] **8.1** `JSMachineTest.java` — create `JSMachine` with a dummy `MachineEnvironment`; call `handleEvent(null, null)`; expect `MachineResult.OK`
- [ ] **8.2** `JSEventBridgeTest.java` — eval `var events = require('events'); events.on("foo", function(v) { result = v; })` from JS; call `handleEvent("foo", new Object[]{"bar"})` from Java; verify `result` equals `"bar"`
- [ ] **8.3** `JSBlockingAPITest.java` — mock a `LuaMethod` that calls `executeMainThreadTask`; verify continuation is captured on first `handleEvent`; fire `task_complete`; verify JS resumes with correct result
- [ ] **8.4** `JSConcurrentEventTest.java` — while a continuation is pending (dig in progress), call `handleEvent("redstone", ...)` and verify the `events.on("redstone", cb)` callback fires without resuming the dig continuation
- [ ] **8.5** `JSRequireTest.java` — write a virtual `.js` file to a test filesystem; `require()` it from bios.js; verify it executes and `module.exports` is returned
- [ ] **8.6** `JSSafePointTest.java` — run `while(true){}` in user JS; verify `MachineResult.TIMEOUT` or error is returned within a bounded time
- [ ] **8.7** Remove/adapt Cobalt-specific tests:
  - Delete `CobaltLuaTableTest.java`, `VarargArgumentsTest.java`, `ErrorInfoLibTest.java`
  - Adapt `ComputerTestDelegate.java` to use `JSMachine` instead of `CobaltLuaMachine`
  - Delete `LuaCoverage.java` (Lua-specific)
- [ ] **Commit** — stage Phase 8 files; propose commit message; wait for user approval

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
- [ ] **Commit** — stage Phase 9 files; propose commit message; wait for user approval

---

## Phase 10 — TypeScript type definitions

The build pipeline is already running from Phase 1.5. This phase adds typed module declarations
so the TypeScript compiler can check all ROM/bios sources against the actual CC API surface.
Defer until the API surface has stabilised (after Phase 9).

- [x] **10.1** Typed module declarations for all CC native modules live in `projects/core/src/ts/types/` — one `.d.ts` per module (`fs`, `path`, `process`, `events`, `http`, `term`, `redstone`, `peripheral`, `turtle`, `commands`, `pocket`), plus `globals.d.ts` (`require` overloads, timers, `sleep`) and `modules.d.ts` (ambient `declare module` for `import` syntax). The `bundleTypeDeclarations` Gradle task collects all `.d.ts` into `build/generated/types/` for publishing as an npm types package. See [JS_API_REDESIGN.md](JS_API_REDESIGN.md).
- [ ] **10.2** Model blocking calls as plain synchronous return types — "can-fail" actions return `{ ok: boolean, reason?: string }` (not a tuple, not a Promise)
- [ ] **10.3** Keep `.d.ts` in sync as Phase 11 / Phase 9 reshape the API surface
- [ ] **Commit** — stage Phase 10 files; propose commit message; wait for user approval

---

## Phase 11 — JS ROM feature planning & implementation

### 11.A — Planning (do this before writing any ROM code)

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

### 11.B — Implementation (driven by `JS_ROM_FEATURES.md`)

Each item below corresponds to a section in `JS_ROM_FEATURES.md`. Write each file as a `.ts`
source under `projects/core/src/ts/rom/`; the Phase 1.5 pipeline transpiles it to the
matching `/rom/` path at build time. Implement in dependency order as noted in the feature specs.

- [ ] **11.3** `bios.ts` — full boot sequence + `read()`, `write()`, `print()` terminal helpers;
  copy/move the stub from Phase 2.4/6.7 and expand it here
- [ ] **11.4** Standard library APIs (`src/ts/rom/apis/`) — one `.ts` per feature spec entry;
  each uses `module.exports = { ... }` and is loadable via `require('<name>')`
- [ ] **11.5** Shell & built-in programs (`src/ts/rom/programs/`) — one `.ts` per feature spec entry
- [ ] **11.6** Compat module (`src/ts/rom/apis/compat.ts`) — Lua-style shims (`tostring`, `tonumber`,
  `type`, `pairs`, `ipairs`, `pcall`, `xpcall`, `error`) for programs that need them
- [ ] **11.7** Help text — copy `lua/rom/help/` markdown files to `src/ts/rom/help/` (copied as-is,
  not transpiled); write `src/ts/rom/help/index.md` listing all available JS programs/APIs
- [ ] **11.8** Verify: full in-game boot reaches the shell prompt; each built-in program runs without error
- [ ] **Commit** — stage Phase 11 files; propose commit message; wait for user approval

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
| Globals | `require` + global timers (`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`, `sleep`) — all APIs (`process`, `events`, `turtle`, `term`, `fs`, …) must be loaded with `require()` |
| Event model | `var events = require('events'); events.on(event, cb)` — synchronous callbacks in `handleEvent()` |
| Sync ops | `turtle.dig()` returns value directly (`{ ok, reason? }`); no `await`, no Promise |
| Modules | `require(id)`: checks native registry first, then CC filesystem; `require.paths = ["/rom/apis"]` |
| Native modules | Java APIs registered by name in `JSRequire.nativeModules`; CC `os` is split into the `process` and `events` modules |
