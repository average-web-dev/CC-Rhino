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
    - `scope = cx.initStandardObjects()`
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
  - The only global set on `scope` is `require` itself (plus the global timer functions `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` and `sleep`)
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
- [ ] **7.5.3** Update `bios.ts` to attempt `require("/startup")` (silently ignores `MODULE_NOT_FOUND`) then boot `/rom/programs/shell.js`
- [ ] **Commit** — stage Phase 7.5 files; propose commit message; wait for user approval

---

## Phase 8 — Testing

- [x] **8.1** `JSMachineTest.java` — create `JSMachine` with a dummy `MachineEnvironment`; call `handleEvent(null, null)`; expect `MachineResult.OK`
- [x] **8.2** `JSEventBridgeTest.java` — eval `var os = require('os'); os.on("foo", cb)` from JS (the emitter is exposed on the `os` module, not a separate `events` module); call `handleEvent("foo", new Object[]{"bar"})` from Java; verify the callback receives `"bar"`. Also covers `once`/`off`.
- [x] **8.3** `JSBlockingAPITest.java` — mock an `ApiMethod` that calls `executeMainThreadTask`; verify the continuation is captured on the first `handleEvent` (code after the call has not run); fire `task_complete`; verify JS resumes with the task result. Also covers a non-matching task id.
- [x] **8.4** `JSConcurrentEventTest.java` — while a continuation is pending (dig in progress), call `handleEvent("redstone", ...)` and verify the `os.on("redstone", cb)` callback fires without resuming the dig continuation; then `task_complete` resumes it.
- [x] **8.5** `JSRequireTest.java` — write a virtual `.js` file to a `MemoryMount` filesystem; `require()` it from bios.js; verify it executes and `module.exports` is returned, is cached across requires, and that a missing module throws `MODULE_NOT_FOUND`.
- [x] **8.6** `JSSafePointTest.java` — run `while(true){}` in user JS and trigger an abort from another thread; verify `MachineResult.TIMEOUT` (hard) / abort-message error (soft) is returned within a bounded time.
- [ ] **8.7** Remove/adapt Cobalt-specific tests:
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

- [x] **10.1** Typed module declarations for all CC native modules live in `projects/core/src/ts/types/` — one `.d.ts` per module (`fs`, `path`, `process`, `events`, `http`, `term`, `redstone`, `peripheral`, `turtle`, `commands`, `pocket`), plus `globals.d.ts` (`require` overloads, timers, `sleep`) and `modules.d.ts` (ambient `declare module` for `import` syntax). The `bundleTypeDeclarations` Gradle task collects all `.d.ts` into `build/generated/types/` for publishing as an npm types package. See [JS_API_REDESIGN.md](JS_API_REDESIGN.md).
- [ ] **10.2** Model blocking calls as plain synchronous return types — "can-fail" actions return `{ ok: boolean, reason?: string }` (not a tuple, not a Promise)
- [ ] **10.3** Keep `.d.ts` in sync as Phase 11 / Phase 9 reshape the API surface
- [ ] **10.4** Audit every `@LuaFunction` method across all API classes (`TurtleMethods`, `FsMethods`, `RedstoneMethods`, `PeripheralAPI`, `HttpMethods`, `PocketAPI`, `CommandsMethods`, etc.) and migrate:
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

- [ ] **11.13** `src/ts/bios.ts` — hardware init only: terminal reset, banner, `require.paths`, boot `/rom/os`
- [ ] **11.14** `src/ts/rom/os/index.ts` — device detection, PATH, aliases, completion registration, autorun, startup discovery, launch bash
- [ ] **11.15** `src/ts/rom/lib/cc/shell/completion.ts` — completion handler factories (`file`, `program`, `help`, `peripheral`)
- [ ] **11.16** `src/ts/rom/bin/bash.ts` — readline loop, PATH search, alias resolution, tab-complete, built-ins (cd, exit, alias, set, help, clear, pwd)

#### Tier 3 — Peripheral + network libraries (depends on Tier 0–2)

- [ ] **11.17** `src/ts/rom/lib/peripheral.ts` — `wrap`, `find`, `getNames`, `isPresent`, `getType`, `call`
- [ ] **11.18** `src/ts/rom/lib/rednet.ts` — open/close, send, broadcast, receive (with timeout), host/lookup, protocol filter
- [ ] **11.19** `src/ts/rom/lib/http.ts` — `get`, `post`, `request`/`checkURL` wrappers with streaming; `websocket`
- [ ] **11.20** `src/ts/rom/lib/gps.ts` — trilateration via `rednet` + modem; `locate()` blocking call
- [ ] **11.21** `src/ts/rom/lib/disk.ts` — disk drive API wrappers

#### Tier 4 — I/O + settings (depends on Tier 0–3)

- [ ] **11.22** `src/ts/rom/lib/settings.ts` — typed key-value store backed by `/.settings` JSON file; `define`, `get`, `set`, `unset`, `load`, `save`
- [ ] **11.23** `src/ts/rom/lib/io.ts` — JS file handles (`io.open`, `io.lines`, `io.read`, `io.write`); stdout/stdin/stderr stream objects
- [ ] **11.24** `src/ts/rom/lib/help.ts` — `setPath`, `path`, `lookup`, `completeTopic`; topics are `.txt` files in help path

#### Tier 5 — Built-in programs (depends on Tier 0–4)

- [ ] **11.25** File management: `ls.ts`, `cp.ts`, `mv.ts`, `rm.ts`, `mkdir.ts`, `type.ts`, `drive.ts`
- [ ] **11.26** Info/control: `id.ts`, `label.ts`, `reboot.ts`, `shutdown.ts`, `clear.ts`, `time.ts`, `about.ts`
- [ ] **11.27** `help.ts` (program) — page help topics from `/rom/help/`; `programs.ts` — list available commands
- [ ] **11.28** `edit.ts` — full-screen text editor: cursor movement, copy/paste, syntax highlighting for `.ts`/`.js`, tab-completion for `require` names
- [ ] **11.29** `js.ts` — interactive JS REPL using `Function()`; print return values via `cc/pretty`; history, tab-completion
- [ ] **11.30** `monitor.ts` — run a program redirecting its terminal output to an attached monitor peripheral
- [ ] **11.31** Network programs: `wget.ts`, `pastebin.ts` (upload/download)
- [ ] **11.32** Rednet programs: `chat.ts` (send/receive messages), `repeat.ts` (wireless relay daemon)
- [ ] **11.33** Peripheral utilities: `peripherals.ts` (list attached), `redstone.ts` (inspect/set sides)
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
- [ ] **12.8** Verify: `os.sleep(0.05)` resumes exactly 1 tick later; multiple concurrent sleeps each fire at the right tick; `queueMicrotask` runs before the next I/O phase
- [ ] **12.9** Update `JS_MIGRATION.md` cross-cutting reference table with event loop model

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
| Globals | `require` + global timers (`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`, `sleep`) — all APIs (`process`, `events`, `turtle`, `term`, `fs`, …) must be loaded with `require()` |
| Event model | `var events = require('events'); events.on(event, cb)` — synchronous callbacks in `handleEvent()` |
| Sync ops | `turtle.dig()` returns value directly (`{ ok, reason? }`); no `await`, no Promise |
| Modules | `require(id)`: checks native registry first, then CC filesystem; `require.paths = ["/rom/apis"]` |
| Native modules | Java APIs registered by name in `JSRequire.nativeModules`; CC `os` is split into the `process` and `events` modules |
