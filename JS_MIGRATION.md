# CC: Tweaked — Lua/Cobalt → GraalJS ES6 Migration

Replace the Cobalt Lua runtime with a GraalJS-based ES6 JavaScript engine.
Users write ES6 JavaScript instead of Lua inside the mod.

**API design:**
- Events → `os.on("redstone", cb)` / `os.once("char", cb)` (Node.js EventEmitter style)
- Blocking ops → `await turtle.dig()` (async/await, computer thread blocks on CompletableFuture)
- Modules → ES6 `import`/`export` resolved against the CC filesystem

**Key constraints:**
- GraalJS interpreter mode only (pure Java JARs, no per-OS builds)
- `ResourceLimits.statementLimit()` safepoint — tight loops never lock up the system
- `ILuaMachine` / `MachineEnvironment` interface surface stays unchanged
- All Java API implementations (turtle, fs, peripheral, …) kept as-is

---

## Phase 1 — Project setup & dependency wiring

- [x] **1.1** Add GraalJS to `gradle/libs.versions.toml`: new `graaljs` version entry + two library entries (`polyglot` and `js-community` from `org.graalvm.polyglot`)
- [x] **1.2** Add GraalJS as `implementation` dependency in `projects/core/build.gradle.kts`; keep Cobalt for now
- [x] **1.3** Add `public static int jsStatementLimit = 10_000;` to `CoreConfig.java`
- [x] **1.4** Smoke-check: `./gradlew :core:compileJava` passes with no errors

---

## Phase 2 — JSMachine skeleton

- [x] **2.1** Create `projects/core/src/main/java/dan200/computercraft/core/lua/JSMachine.java` implementing `ILuaMachine`
  - Constructor: create a GraalJS `Context` in interpreter mode (`engine.WarnInterpreterOnly=false`, `allowHostAccess(HostAccess.ALL)` temporarily)
  - `handleEvent()` → runs bios on first call (startup), returns `MachineResult.OK`
  - `printExecutionState()` → stub
  - `close()` → `context.close(true)`
- [x] **2.2** Create `projects/core/src/main/java/dan200/computercraft/core/computer/JSContext.java` implementing `ILuaContext`
  - `issueMainThreadTask()` → same as `LuaContext` (queue via `computer.queueMainThread()`, return task ID)
  - Override `executeMainThreadTask()`: queue task via `computer.queueMainThread()`, block computer thread on a `CompletableFuture<Object[]>` (30 s timeout), return `MethodResult.of(result)` — bypasses the `TaskCallback`/`task_complete` event chain
- [x] **2.3** In `ComputerContext.Builder.build()` change the default factory from `CobaltLuaMachine::new` to `JSMachine::new`
- [x] **2.4** Create `projects/core/src/main/resources/data/computercraft/js/bios.js` — minimal stub: `print("JS bios loaded");`
- [x] **2.5** In `ComputerExecutor.createLuaMachine()` change the resource path from `"lua/bios.lua"` to `"js/bios.js"`, and pass `JSContext` instead of `LuaContext`
- [x] **2.6** Verify: `JSMachineTest` (3 tests) — boot returns OK, `print()` runs without error, subsequent events return OK

---

## Phase 3 — Tight loop safepoint (ResourceLimits)

- [x] **3.1** In `JSMachine` constructor, attach `ResourceLimits` to the GraalJS context:
  `ResourceLimits.newBuilder().statementLimit(CoreConfig.jsStatementLimit, null).onLimit(this::safepoint).build()`
- [x] **3.2** Implement `safepoint(ResourceLimitEvent)` in `JSMachine`:
  - `isDisposed || timeout.isHardAborted()` → return without `resetLimits()` → `isResourceExhausted` thrown
  - `timeout.isSoftAborted()` → same (no reset) → caught in `handleEvent()` as `error(ABORT_MESSAGE)`
  - `timeout.isPaused()` → spin-wait with `LockSupport.parkNanos(1ms)` then `resetLimits()`
  - Normal → `resetLimits()` and return (execution continues)
- [x] **3.3** In `handleEvent()` / `mapException()`: catch `PolyglotException`:
  - `isResourceExhausted()` → check `isHardAborted` → TIMEOUT or `error(ABORT_MESSAGE)`
  - `isInterrupted()` or `isCancelled()` → TIMEOUT
  - Other → `error(message)` + close
- [x] **3.4** `onTimeoutChanged()` listener calls `context.interrupt(Duration.ofMillis(10))` on hard abort for sub-safepoint response; `TimeoutException` swallowed (signal was sent)

---

## Phase 4 — EventEmitter bridge

- [x] **4.1** Embed a minimal EventEmitter JS class (`on/once/off/emit/listenerCount`) in `JSMachine`; eval at construction, store instance as `emitter` field
- [x] **4.2** `globalThis.__emitter__` set in JS scope; `os.on/once/off` wrappers injected by JSMachine constructor so they are available to any bios or test code
- [x] **4.3** `handleEvent`: startup fires `__start__`; subsequent calls dispatch via `emitter.emit(name, ...jsArgs)`; `toJsValue()` handles null/Boolean/Number/String/array/Collection/Map; microtask flush via `(async()=>{})()` after each dispatch
- [x] **4.4** `os.on/once/off` wrappers live in JSMachine constructor; bios.js simplified to use them directly
- [x] **4.5** `dispatchEvent` returns OK immediately when eventName is null

---

## Phase 5 — Async API bridge (Java ILuaAPI → JS proxy objects)

- [x] **5.1** Create `JSValues.java` — bidirectional Java ↔ JS value converter
  - `toJS(Context ctx, Object java)` → handles null, Number, Boolean, String, byte[], ByteBuffer, Map, Collection, Object[], ILuaFunction, IDynamicLuaObject (recursive, cycle-safe via `IdentityHashMap`)
  - `toJava(Value v)` → handles number, boolean, string, array-like, object-like
- [x] **5.2** `JSArguments.java` — `IArguments` backed by `Value[]`; `get()` uses `JSValues.toJava()`; `getDouble/getLong` use polyglot `asDouble/asLong`; `getTableUnsafe()` converts to `ObjectLuaTable` via `JSValues`; `drop()` via offset
- [x] **5.3** `JSTableImpl` skipped — `getTableUnsafe()` eagerly converts to `ObjectLuaTable` instead (simpler, correct for all CC use cases)
- [x] **5.4** `JSMethodBridge.java` — `ProxyExecutable` wrapping `LuaMethod`; no-callback → `JSValues.resultToJs()`; callback → `__createPromise__` captures resolve/reject, stored as `PendingCallback` in JSMachine
- [x] **5.5** `JSAPIBuilder.java` — enumerates methods via `forEachMethod`, wraps each as `JSMethodBridge`, returns `ProxyObject.fromMap()`
- [x] **5.6** `JSMachine` constructor now registers every API as a JS global; also registers `moduleName` if present
- [x] **5.7** `bios.js` updated — `print()` uses `term.write()` + `term.setCursorPos()`; `__start__` prints ready message
- [x] **5.8** Fabric client launches cleanly; computer boots; bios.js runs via Java API proxies; in-game verification deferred to Phase 6 (user programs require the module resolver to run arbitrary JS files)

---

## Phase 6 — ES6 module resolver

- [x] **6.1** `JSFileSystem.java` — `org.graalvm.polyglot.io.FileSystem` backed by CC `FileSystem`; reads via `openForRead()` → `FileSystemWrapper.get()` → buffered `SeekableByteChannel`; writes throw `AccessDeniedException`; MIME type `application/javascript+module` for `.js`/`.mjs`
- [x] **6.2** `JSMachine` wires `JSFileSystem.ioAccess(env.fileSystem())` via `.allowIO()`; falls back to `IOAccess.NONE` when fileSystem is null (unit tests)
- [x] **6.3** `js.esm-eval-returns-exports=true` already set since Phase 2
- [x] **6.4** `bios.js` `__start__` handler does `await import("/startup.js")` → calls `mod.default()` if exported; silently ignores missing file
- [x] **6.5** `MachineEnvironment` extended with `@Nullable FileSystem fileSystem`; `ComputerExecutor` passes the live `fileSystem`; in-game test: create `/startup.js` with `export default () => print("hello")`

---

## Phase 7 — Sandboxing & security

- [x] **7.1** Tighten GraalJS context host access:
  - `.allowHostAccess(HostAccess.NONE)` — no Java reflection from JS
  - `.allowHostClassLookup(name -> false)` — no `Java.type()` access
  - `.allowCreateThread(false)`
  - `.allowNativeAccess(false)`
  - `.allowIO(IOAccess.newBuilder().fileSystem(jsFileSystem).build())` — CC FS only
  - Expose API proxies as host objects using a custom `HostAccess` that whitelists only `ProxyObject`/`ProxyExecutable`
- [x] **7.2** Verify `Java.type("java.lang.Runtime")` throws from JS; verify `Packages.java.lang.System.exit(0)` fails
- [x] **7.3** Verify API proxy objects only expose the annotated methods, not arbitrary Java fields or reflection

---

## Phase 7.5 — JS ROM & standard library

Translate the Lua ROM (`lua/rom/`) into a JS equivalent so the computer is fully usable
out of the box — shell, built-in programs, standard library APIs, and startup sequence.

### 7.5.A — Resource layout

- [ ] **7.5.A.1** Create `projects/core/src/main/resources/data/computercraft/js/rom/` mirroring the structure of `lua/rom/`
- [ ] **7.5.A.2** Update `ComputerExecutor` to mount `js/rom` at `/rom` in the CC filesystem (currently `lua/rom` is mounted — swap or add alongside)
- [ ] **7.5.A.3** Update `bios.js` to boot the JS shell (`/rom/programs/shell.js`) after loading startup scripts

### 7.5.B — Standard library JS APIs (`/rom/apis/`)

Each file is a JS module (`export default { ... }`) that bios.js imports and injects as a global.

- [ ] **7.5.B.1** `colors.js` / `colours.js` — colour constants (white=1, orange=2, … black=32768) + `combine`, `subtract`, `test`, `packRGB`, `unpackRGB`
- [ ] **7.5.B.2** `keys.js` — key-name-to-keycode map (LWJGL key codes)
- [ ] **7.5.B.3** `textutils.js` — `serialize`/`unserialize` (JSON-compatible), `formatTime`, `tabulate`, `pagedTabulate`, `slowPrint`, `urlEncode`
- [ ] **7.5.B.4** `math.js` — thin wrappers / re-exports of JS `Math` with Lua-compatible naming (`math.floor`, `math.ceil`, `math.random`, `math.huge`, etc.)
- [ ] **7.5.B.5** `string.js` — Lua-style string library shim (`string.format`, `string.find`, `string.match`, `string.gmatch`, `string.gsub`, `string.rep`, `string.reverse`, `string.byte`, `string.char`, `string.len`, `string.sub`)
- [ ] **7.5.B.6** `table.js` — `table.insert`, `table.remove`, `table.concat`, `table.sort`, `table.unpack` shims over JS Array methods
- [ ] **7.5.B.7** `vector.js` — 3D vector class with `add`, `sub`, `mul`, `dot`, `cross`, `length`, `normalize`, `tostring`
- [ ] **7.5.B.8** `window.js` — terminal window API (sub-terminal redirects)

### 7.5.C — Shell & REPL (`/rom/programs/`)

- [ ] **7.5.C.1** `shell.js` — interactive shell: reads a line, splits into program + args, looks up `/rom/programs/<cmd>.js` or `/<cmd>.js`, imports and runs it; handles `exit`, `cd`, `path`
- [ ] **7.5.C.2** `ls.js` — lists files in the current/given directory
- [ ] **7.5.C.3** `help.js` — reads `/rom/help/<topic>.md` and prints it to the terminal
- [ ] **7.5.C.4** `edit.js` — minimal line editor: open/create a file, edit lines, save (reuse existing CC terminal drawing logic)
- [ ] **7.5.C.5** `reboot.js` and `shutdown.js` — call `os.reboot()` / `os.shutdown()`
- [ ] **7.5.C.6** `echo.js`, `clear.js`, `time.js`, `id.js` — trivial one-liners

### 7.5.D — `read()` and terminal helpers in bios.js

- [ ] **7.5.D.1** Implement `read(replaceChar, history, completeFn)` in bios.js using `os.on("char", ...)` / `os.on("key", ...)` Promises — line input with backspace, history, and optional tab-complete
- [ ] **7.5.D.2** Implement `write(text)` (no newline) using `term.write()` + cursor tracking
- [ ] **7.5.D.3** Implement `tostring` / `tonumber` / `type` / `pairs` / `ipairs` / `pcall` / `xpcall` / `error` shims for Lua-familiar patterns

### 7.5.E — Help text

- [ ] **7.5.E.1** Copy `lua/rom/help/` markdown files to `js/rom/help/` (content is language-agnostic)
- [ ] **7.5.E.2** Write `js/rom/help/index.md` listing all available JS programs/APIs

---

## Phase 8 — Testing

- [ ] **8.1** `JSMachineTest.java` — create `JSMachine` with a dummy `MachineEnvironment`; call `handleEvent(null, null)`; expect `MachineResult.OK`
- [ ] **8.2** `JSEventBridgeTest.java` — register `os.on("foo", cb)` from JS; call `handleEvent("foo", new Object[]{"bar"})` from Java; verify callback ran with `"bar"`
- [ ] **8.3** `JSBlockingAPITest.java` — mock a `LuaMethod` that calls `executeMainThreadTask`; call it from JS; verify the result is returned correctly
- [ ] **8.4** `JSModuleTest.java` — write a virtual `.js` file to a test filesystem; import it from bios.js; verify it executes
- [ ] **8.5** `JSSafePointTest.java` — run `while(true){}` in user JS; verify `MachineResult.TIMEOUT` or error is returned within a bounded time
- [ ] **8.6** Remove/adapt Cobalt-specific tests:
  - Delete `CobaltLuaTableTest.java`, `VarargArgumentsTest.java`, `ErrorInfoLibTest.java`
  - Adapt `ComputerTestDelegate.java` to use `JSMachine` instead of `CobaltLuaMachine`
  - Delete `LuaCoverage.java` (Lua-specific)

---

## Phase 9 — Cleanup & rename

- [ ] **9.1** Remove Cobalt from `gradle/libs.versions.toml` (both `[versions]` and `[libraries]`) and from `projects/core/build.gradle.kts`
- [ ] **9.2** Delete `CobaltLuaMachine.java`
- [ ] **9.3** Delete `ResultInterpreterFunction.java`
- [ ] **9.4** Delete `VarargArguments.java`
- [ ] **9.5** Delete `TableImpl.java`
- [ ] **9.6** Delete `errorinfo/ErrorInfoLib.java` and `errorinfo/DebugHelpers.java`
- [ ] **9.7** Delete `projects/web/src/builder/java/cc/tweaked/web/builder/PatchCobalt.java`
- [ ] **9.8** Rename `ILuaMachine` → `IMachine` and `ILuaMachine.Factory` → `IMachine.Factory` everywhere:
  - Rename the interface file and update all references in `ComputerContext`, `ComputerExecutor`, `MachineEnvironment`, `MachineResult`, `TimeoutState` Javadoc, and any tests
  - Move from package `dan200.computercraft.core.lua` to `dan200.computercraft.core.machine` (or keep in `lua` and just rename — decide at time of execution)
- [ ] **9.9** Rename `MachineEnvironment`, `MachineResult`, `MachineException` Javadocs to drop Lua-specific language
- [ ] **9.10** Add SPDX headers (MPL-2.0) to all new source files
- [ ] **9.11** Decide (with user) whether to remove `lua/rom/` resources or keep Lua machine as an opt-in fallback

---

## Phase 10 — Author ROM/bios in TypeScript, transpile on build

Move the hand-written `.js` sources (`data/computercraft/js/` — bios + `rom/apis/` + `rom/programs/`,
~30 files) to TypeScript and transpile them to `.js` during the Gradle build. The runtime keeps
loading `.js` from resources unchanged; only the authoring format changes.

### 10.A — Mechanical conversion (transpile-on-build)

- [ ] **10.A.1** Create `projects/core/src/ts/` and move the 30 `.js` files there as `.ts`, mirroring the
  `rom/apis` / `rom/programs` layout. Author imports with explicit `.js` extensions
  (e.g. `import colors from "./colors.js"`) — GraalJS ESM resolves real paths, so the emitted
  output must keep identical filenames/structure.
- [ ] **10.A.2** Add `projects/core/src/ts/tsconfig.json` (base it on `projects/web/tsconfig.json`:
  `module: esNext`, `moduleResolution: bundler`, `target: es2017`, `strict`, `noEmitOnError`).
  Emit-only — no bundling — so the on-disk layout maps 1:1 to `data/computercraft/js/`.
- [ ] **10.A.3** Wire transpile into the `:core` build, reusing the existing `cc-tweaked.node`
  convention plugin + `NpxExecToDir` task (see `projects/web/build.gradle.kts:69`). Register a
  `transpileJs` task that runs `tsc` into `build/generated/js`, with `inputs.dir(src/ts)` /
  `outputs.dir` for incremental, cacheable builds.
- [ ] **10.A.4** Feed the generated dir into `processResources` under `data/computercraft/js/`
  (and add to the main sourceSet resources) so the jar ships the transpiled `.js`. Remove the
  now-generated `.js` files from `src/main/resources` and gitignore the generated output.
- [ ] **10.A.5** Use `tsc` (not swc/esbuild) so type errors fail the build via `noEmitOnError`.
- [ ] **10.A.6** Verify: `./gradlew :core:processResources` emits `.js` with unchanged paths;
  `JSMachineTest` + in-game boot still pass.

### 10.B — Type definitions (the actual TS payoff — optional, defer until API surface settles)

- [ ] **10.B.1** Write ambient `.d.ts` (`declare global`) for the injected CC globals/APIs
  (`term`, `os`, `fs`, `turtle`, `peripheral`, `colors`, …). These come from Java proxies in
  `JSMachine`, so they are not importable and must be hand-declared.
- [ ] **10.B.2** Model the async signatures (`await turtle.dig()`, `executeMainThreadTask` results)
  as `Promise`-returning so `strict` mode is meaningful.
- [ ] **10.B.3** Keep the `.d.ts` in sync as Phase 7.5 / Phase 9 reshape the API surface.

> Note: 10.A is cheap (~½ day) and worth doing whenever; 10.B is days of work + ongoing
> maintenance and only pays off once the API is stable, so it can lag behind 10.A.

---

## Cross-cutting reference

| Concern | Approach |
|---|---|
| Tight loop | `ResourceLimits.statementLimit(CoreConfig.jsStatementLimit, safepoint)` |
| Hard abort | `context.close(true)` from TimeoutState listener |
| Soft abort | Safepoint evals a throwing JS snippet with CC abort message |
| Pause/preemption | Spin-wait in safepoint callback until `isPaused()` clears |
| Main-thread tasks | Computer thread blocks on `CompletableFuture`; main thread completes it |
| GraalJS mode | Interpreter only — pure Java JARs, no per-OS native builds |
| Security | `HostAccess.NONE`, no threads, no native, CC FS only |
| Event model | `os.on(event, cb)` / `os.once(event, cb)` — callbacks, not coroutines |
| Async ops | `await turtle.dig()` — Java blocks computer thread, returns resolved value |
| Modules | ES6 `import`/`export` via `JSFileSystem` on CC filesystem |