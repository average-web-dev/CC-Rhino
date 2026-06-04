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

- [ ] **3.1** In `JSMachine` constructor, attach `ResourceLimits` to the GraalJS context:
  `ResourceLimits.newBuilder().statementLimit(CoreConfig.jsStatementLimit, ctx -> safepoint()).build()`
- [ ] **3.2** Implement `safepoint()` in `JSMachine`:
  - `timeout.isHardAborted() || isDisposed` → `context.close(true)` (cancel executing)
  - `timeout.isSoftAborted()` → eval a throwing JS snippet to surface the abort message
  - `timeout.isPaused()` → spin-wait with `LockSupport.parkNanos` until no longer paused or hard-aborted
- [ ] **3.3** In `handleEvent()`, catch `PolyglotException`:
  - Context cancelled → return `MachineResult.TIMEOUT`
  - Message equals `TimeoutState.ABORT_MESSAGE` → `close()` + return `MachineResult.error(...)`
- [ ] **3.4** Register a `TimeoutState` listener in the constructor (and remove it in `close()`) that calls `context.interrupt()` on hard abort — mirrors the Cobalt approach

---

## Phase 4 — EventEmitter bridge

- [ ] **4.1** Embed a minimal EventEmitter JS class as a Java string constant in `JSMachine`; eval it once at startup and store the result `Value` as `emitter`
  - API: `on(event, fn)`, `once(event, fn)`, `off(event, fn)`, `emit(event, ...args)`, `listenerCount(event)`
- [ ] **4.2** Expose the emitter to bios.js as `globalThis.__emitter__`
- [ ] **4.3** In `handleEvent(eventName, args)`:
  - Convert `Object[]` → JS values (use `JSValues.toJS()` from Phase 5)
  - Eval `globalThis.__emitter__.emit(eventName, ...convertedArgs)`
  - On startup (`eventName == null`), eval `globalThis.__emitter__.emit("__start__")`
  - After dispatch, flush the GraalJS microtask queue: eval `await Promise.resolve()` (or equivalent)
- [ ] **4.4** Expose `os.on` / `os.once` / `os.off` in bios.js as thin wrappers over `__emitter__`
- [ ] **4.5** On events with no listeners, return `MachineResult.OK` immediately (skip dispatch overhead)

---

## Phase 5 — Async API bridge (Java ILuaAPI → JS proxy objects)

- [ ] **5.1** Create `JSValues.java` — bidirectional Java ↔ JS value converter
  - `toJS(Context ctx, Object java)` → handles null, Number, Boolean, String, byte[], ByteBuffer, Map, Collection, Object[], ILuaFunction, IDynamicLuaObject (recursive, cycle-safe via `IdentityHashMap`)
  - `toJava(Value v)` → handles number, boolean, string, array-like, object-like
- [ ] **5.2** Create `JSArguments.java` implementing `IArguments`
  - Backed by `Value[]` from a GraalJS call
  - `get(int)` → `JSValues.toJava(jsArgs[index])`
  - `getDouble/getLong/getBytes` → after basic conversion, delegate to `LuaValues` helpers for error messages
  - `getTableUnsafe()` → wrap the JS Value as a `JSTableImpl` (see 5.3)
  - `escapes()` → always safe (values already on Java side)
- [ ] **5.3** Create `JSTableImpl.java` implementing `LuaTable<Object, Object>`
  - Backed by a GraalJS `Value` (array or object)
  - `get(Object key)` → `JSValues.toJava(value.getMember(key.toString()))`
  - `size()` / `length()` via `getArraySize()` or member iteration
  - Read-only (throw on mutation)
- [ ] **5.4** Create `JSMethodBridge.java` — wraps a `LuaMethod` + target as a GraalJS `ProxyExecutable`
  - `execute(Value... jsArgs)`:
    1. Build `JSArguments` from `jsArgs`
    2. Call `method.apply(target, jsContext, jsArguments)`
    3. No callback on `MethodResult` → convert result `Object[]` to JS values, return
    4. Callback present (`pullEvent` pattern) → register one-shot `__emitter__` listener for the filter event, return a JS `Promise` that resolves via `callback.resume(eventArgs)`; if `resume()` returns another `MethodResult`, chain recursively
  - Catch `LuaException` → throw as JS `Error`
- [ ] **5.5** Create `JSAPIBuilder.java`
  - Takes `ILuaAPI api`, `MethodSupplier<LuaMethod> methods`, `JSContext jsContext`, `Context graalContext`
  - Enumerates methods via `methods.forEachMethod(api, ...)` → builds a `ProxyObject` with one named member per method (each a `JSMethodBridge`)
- [ ] **5.6** In `JSMachine` constructor, after context creation: for each API in `environment.apis()`, build a proxy via `JSAPIBuilder` and register it as a global binding (`context.getBindings("js").putMember(...)`)
- [ ] **5.7** Update bios.js: add `print(...args)` using `term.write()` + `term.setCursorPos()`, add minimal `read()` using `os.once("char", ...)` Promise wrapper
- [ ] **5.8** Manual integration check: write a JS program that calls `turtle.forward()`, `turtle.dig()`, `peripheral.getNames()`, and `fs.list("/")` and verify results

---

## Phase 6 — ES6 module resolver

- [ ] **6.1** Create `JSFileSystem.java` implementing `org.graalvm.polyglot.io.FileSystem`
  - Resolves paths relative to the CC computer's `FileSystem`
  - `parsePath(uri)`, `toRealPath()`, `newByteChannel()` → read from CC `FileSystem`
  - Writes → throw `UnsupportedOperationException` (no write access via import)
  - Only allow `.js` files
- [ ] **6.2** Register `JSFileSystem` in the GraalJS context builder (`.fileSystem(new JSFileSystem(...))`)
- [ ] **6.3** Set GraalJS option `js.esm-eval-returns-exports=true` so top-level `export` works
- [ ] **6.4** Update bios.js to dynamically import the user's startup script: `await import('/startup.js')`
- [ ] **6.5** Integration test: write `/startup.js` with `export default () => print("hello from module")`, verify it executes

---

## Phase 7 — Sandboxing & security

- [ ] **7.1** Tighten GraalJS context host access:
  - `.allowHostAccess(HostAccess.NONE)` — no Java reflection from JS
  - `.allowHostClassLookup(name -> false)` — no `Java.type()` access
  - `.allowCreateThread(false)`
  - `.allowNativeAccess(false)`
  - `.allowIO(IOAccess.newBuilder().fileSystem(jsFileSystem).build())` — CC FS only
  - Expose API proxies as host objects using a custom `HostAccess` that whitelists only `ProxyObject`/`ProxyExecutable`
- [ ] **7.2** Verify `Java.type("java.lang.Runtime")` throws from JS; verify `Packages.java.lang.System.exit(0)` fails
- [ ] **7.3** Verify API proxy objects only expose the annotated methods, not arbitrary Java fields or reflection

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