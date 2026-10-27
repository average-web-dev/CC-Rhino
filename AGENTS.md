<!--
SPDX-FileCopyrightText: 2026 average-web-dev

SPDX-License-Identifier: MPL-2.0
-->

# AGENTS.md — working notes for AI agents

**CC: Rhino** is a fork of CC: Tweaked (Minecraft 1.21.x, Forge/NeoForge + Fabric) that replaces the Lua/Cobalt
runtime with Mozilla **Rhino** (JavaScript). In-game computers and turtles are programmed in JS/TypeScript with a
Node.js-flavoured API and a Linux-inspired ROM (bios → os → bash). Compatibility with the old Lua API is **not** a
goal of the core runtime.

- Branch: `mc-1.21.x-Rhino` · GitHub: `average-web-dev/CC-Rhino` (fork of `cc-tweaked/CC-Tweaked`)
- Always pass `--repo average-web-dev/CC-Rhino` to `gh` — never open issues/PRs against upstream.

## Key documents (read before larger changes)

| File | Contents |
|---|---|
| [JS_MIGRATION.md](JS_MIGRATION.md) | Phase-by-phase migration plan + checklists, event-loop model, Rhino authoring constraints |
| [JS_API_REDESIGN.md](JS_API_REDESIGN.md) | Target JS API surface per module (`fs`, `system`, `events`, `turtle`, …) |
| [JS_ROM_FEATURES.md](JS_ROM_FEATURES.md) | Feature spec for every ROM library/program to port |
| [projects/ARCHITECTURE.md](projects/ARCHITECTURE.md) | Upstream module layout (core / common / forge / fabric) |

The checklists in `JS_MIGRATION.md` sometimes lag behind the code — verify against the source and tick items off
when you finish them.

## Build & test

JDK 25 is required (`JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64`), plus Node ≥ 20 for `tsc`.

```sh
./gradlew :core:compileJava                      # core engine + APIs
./gradlew :core:test                             # all core tests
./gradlew :core:test --tests "dan200.computercraft.core.engine.*"   # JS engine tests
./gradlew :core:processResources                 # transpiles src/ts → build/generated/js (transpileTypeScript)
./gradlew :common:generateTsTypes                # .d.ts from @ScriptFunction javadoc → common/build/tsTypes
./gradlew :common:compileJava                    # turtles, peripherals, shared MC code
./gradlew runGametest                           # in-game integration tests (Forge + Fabric, starts a server)
./gradlew :forge:runClient / :fabric:runClient   # in-game testing
```

CI (`.github/workflows/main-ci.yml`) runs `assemble`, `test` and `runGametest` on Linux and `:core:test` on Windows.
The docs website, Lua lint and the TeaVM web emulator are disabled (`TODO(rhino)`, #17); `:web:docWebsite` is not
part of `assemble`.

- Gradle builds and especially `runGametest` are memory-hungry. Don't run several in parallel (e.g. from multiple
  agents/worktrees at once), and stop daemons when done (`./gradlew --stop`).
- New `@cc.*` / `@cc-r.*` javadoc tags used by the TypeScript doclet must be added to the hidden-tag list in
  `buildSrc/src/main/kotlin/cc-tweaked.java-convention.gradle.kts`, otherwise `:common-api:javadoc` fails in CI.
- The tsdoclet **fails** `generateTsTypes` when a script method's TS type would be `unknown` (an `Object`/
  `MethodResult`/`Map<?, ?>` return, an `IArguments` parameter, …) without `@cc-r.return` / `@cc-r.params` /
  `@cc-r.overload`. Other tags: `@cc-r.options` (record used as an options bag → `@Nullable` components become
  optional, and `ScriptUtil.toRecord` accepts them missing), `@cc-r.extends` (extra TS supertypes, e.g. a handle
  exposing a `ReadHandle` via `ObjectSource`), `@cc-r.param <component> <type>` on records. `{@inheritDoc}` is
  resolved. Item/block/entity/fluid detail shapes are hand-written in `projects/core/src/ts/types/details.d.ts`;
  events are `@Event` records (`CoreEvents`, `PeripheralEvents`) that make up the generated `EventMap` (plus an empty,
  augmentable `CustomEventMap` for `events.emit`). **Queue events through their record** (`computer.queueEvent(new CoreEvents.Timer(id))`; `queueEvent(Record)` exists on
  `IComputerAccess`, `AttachedComputerSet`, `IAPIEnvironment`, `Computer`, `ServerComputer`), never with a raw name and
  argument list, so the declaration and the queued arguments cannot drift. A varargs record
  (`record ComputerCommand(String... args)`) spreads its last component and becomes a rest element in `EventMap`.
- Every script-object type (modules and the objects their methods return) also gets a `<Name>Promises` interface;
  require-able modules additionally get `require("<module>/promises")` declarations.
- The ROM and the TS test fixtures are compiled by `projects/core/src/build/compile-ts.mjs` (tsc via the TS API, plus a
  transform that parenthesizes every `yield`: Rhino rejects `f(yield x)` and parses `yield`'s operand as a comma
  expression).

## Where things live

| Area | Path |
|---|---|
| JS machine (Rhino context, safepoint, sandbox) | `projects/core/src/main/java/dan200/computercraft/core/engine/JSMachine.java` |
| Event loop (timers / IO / microtasks / yields / setImmediate) | `core/engine/EventLoop.java` |
| Green threads (`parallel` module), thread ownership/cancellation, Ctrl+T | `core/engine/JSParallel.java`, `JSThread.java`, `JSTaskGroup.java`, `EventLoop.java` |
| `require()` resolver + module cache (`require.uncached`, `require.resolve`) | `core/engine/JSRequire.java` (+ `REQUIRE_SETUP_JS` in `JSMachine`) |
| Java ⇄ JS value conversion (records, cycle-safe tables, `ArrayTable`) | `core/engine/JSValues.java`, `JSArguments.java` |
| Wrapping returned Java objects with script methods (handles, dynamic objects) | `core/engine/JSObjects.java` |
| Java method → JS function, continuation capture, errors thrown at the call site | `core/engine/JSMethodBridge.java`, `JSAPIBuilder.java`, `JSCallShim.java`, `JSErrors.java` |
| Deferring JS callbacks from native code onto the event loop (e.g. fs callbacks) | `core/engine/JSScheduler.java` |
| Promises: `/promises` modules, promise jobs, `async`/`tslib` modules, async-code detection | `core/engine/JSPromises.java`, `Waiter.java`, `JSAPIBuilder.java` (+ `EventLoop`) |
| Safepoint aborts, resource limits | `core/engine/JSAbort.java`, `JSLimits.java`, `core/CoreConfig.java` (+ `ConfigSpec`) |
| Node-style stdio: `process`, `console`, `util`, `readline` (+`/promises`), terminal driver + job control | `projects/core/src/ts/rom/lib/` (`internal/tty.ts`, `internal/globals.ts`, `internal/emitter.ts`); types in `src/ts/types/{process,console,util,readline}.d.ts` |
| Event bus (`events.on/once/off/emit`, `fireNow`, native-name registry) | `core/engine/JSEventEmitter.java` (incl. the JS `emit`), `core/apis/EventsAPI.java`, `EventLoop.emitPlan`/`dispatchNow`, core-api `scripting/Events.java` |
| Core APIs (`fs`, `system`, `term`, `http`, `peripheral`, `redstone`) | `projects/core/src/main/java/dan200/computercraft/core/apis/` |
| Scripting API for addon mods (`@ScriptFunction`, `MethodResult`, `Result`, `TaskCompletion`) | `projects/core-api/src/main/java/dan200/computercraft/api/scripting/` |
| Turtle API + command queue | `projects/common/.../shared/turtle/apis/TurtleAPI.java`, `turtle/core/TurtleBrain.java` |
| Turtle energy (FE / Tech Reborn Energy) | `forge|fabric/.../shared/turtle/TurtleEnergyStorage.java`, `TurtleBrain.pushEnergy` |
| TypeScript → `.d.ts` generator | `projects/tsdoclet/` |
| ROM (TypeScript, transpiled to `/rom`, bios to `bios.js`) | `projects/core/src/ts/` (`bios.ts`, `rom/os`, `rom/bin`, `rom/os/bin`, `rom/lib`, `types/`) |
| Legacy Lua ROM (reference only, not shipped to the JS machine) | `projects/core/src/main/resources/data/computercraft/lua/` |
| Core test harness (runs `/test.js` on a real computer) | `projects/core/src/test/java/dan200/computercraft/core/computer/ComputerBootstrap.java` |
| Interactive harness (real bios/ROM, type keys, read the screen) | `core/computer/TerminalHarness.java` (used by `StdioShellTest`, `StdioTerminalTest`); ROM library tests: `StdioLibraryTest` + `src/test/resources/stdio/*.js` |
| Engine unit tests (`JSMachineBuilder` + `Recorder` probe API) | `projects/core/src/test/java/dan200/computercraft/core/engine/` |
| Gametest mod (JS test programs, structures, Kotlin tests) | `projects/common/src/testMod/` |

## Runtime model (short)

- Globals, like Node: the engine injects only `require`; the bios adds `process` and `console`
  (`/rom/lib/internal/globals`, also `require('process')` / `require('console')`, same objects). There is no
  `print`/`write`: use `console.log` / `process.stdout.write`. Every computer API is a native module:
  `require('fs')`, `require('system')`, `require('events')`, `require('turtle')` … Native modules only exist when
  the hardware is present (e.g. `turtle` only on turtles).
- Node-style stdio (#34) is ROM TypeScript in `/rom/lib`: `process`, `console`, `util`, `readline`,
  `readline/promises`. These "ROM core modules" resolve before `require.paths` and with a `node:` prefix
  (`JSRequire.ROM_CORE_MODULES`). `/rom/lib/internal/tty.ts` is the terminal driver: stdout/stderr write with VT
  semantics (wrapping, ANSI SGR colours → CC colours, cursor/erase CSI sequences; stderr in red); stdin turns
  `char`/`key`/`paste` into a Node TTY stream (cooked line discipline or raw VT sequences, `'keypress'` events). Its
  input listeners are registered by the bios (root thread) first; `process.stdin.on(...)` registers native listeners
  in the *calling* thread, so a program's stdin handlers may block and die with the program. bash runs each program
  as a job (`tty.beginJob/waitForJob/endJob`): fresh stdin, `process.argv`, cwd restored afterwards, and the program
  keeps running while it reads stdin (like a Node process) until it closes its interface or calls `process.exit()`.
  `readline.Interface#question` without a callback **blocks**; `readline/promises` returns a promise (hand-written —
  the engine's generated `/promises` modules exist only for native modules).
- Blocking calls look synchronous. A Java method returns a `MethodResult` with a destination
  (`TIMER` / `IO` / `YIELD`); `JSMethodBridge` captures a Rhino continuation, `EventLoop` parks it in the matching
  bucket, and `JSMachine.handleEvent` resumes it when the event arrives. Other `events.on` listeners keep running
  meanwhile.
- Main-thread work: `@ScriptFunction(mainThread = true)` or `TaskCallback`; externally-completed work (turtle
  command queue) uses `TaskCompletion.await(taskId)` and the standard `task_complete` event.
- Return values: one value per call. Can-fail actions return a `Result` record (`{ success, reason? }`); structured data
  should be Java **records** (converted by reflection in `JSValues.toJs`, field names = component names).
  Real errors are thrown (`ScriptException`).
- A failed blocking call (`task_complete` with `ok = false`) throws a normal, catchable JS `Error` at the call site
  (`JSCallShim`). `ScriptException` extra properties (e.g. fs `code`) are copied onto the error (`JSErrors`).
- Continuations only work when JS is entered via `executeScriptWithContinuations` / `callFunctionWithContinuations`.
  A JS callback invoked directly from Java (`fn.call(...)`) **cannot** call blocking APIs — schedule it through
  `JSScheduler.callLater` instead. Blocking APIs also fail inside generators and promise jobs (Rhino runs them
  through Java): there they throw "`x.y` blocks and cannot be used inside async code — use require('x/promises')
  instead" (`JSPromises.blockingError`). Methods that may block are rejected *before* they run, also in other native
  callbacks (`forEach`, a `Promise` executor): `JSMethodBridge` captures the continuation *before* calling such a
  method and drops it if the method returns immediately. "May block" = a `MethodResult` return or `mainThread`, and
  for `IFunction`s / `IDynamicObject` methods everything not declared otherwise (`IFunction.nonYielding(fn)`,
  `IDynamicObject.isNonYielding(i)`).
- Concurrency: `require('parallel')` is native (green threads). Every parked continuation, listener, microtask and
  `setImmediate` belongs to a thread; stopping a thread discards them. Ctrl+T raises `Error("Terminated")` in the
  foreground program; bash runs each program as a foreground thread. There is deliberately **no** public
  `pullEvent`/`queueEvent`.
- Events: native events (`@Event` records → `EventMap`) are queued with `queueEvent(record)` from any thread and reach
  listeners on a later tick (listeners may block; blocked calls waiting for the event are woken). `events.emit(name,
  ...args)` delivers *script-defined* events synchronously (Node semantics, returns "had listeners"); native names
  are rejected (`ERR_RESERVED_EVENT`), custom ones are typed by augmenting `CustomEventMap`. Java code already inside
  the machine (a script method) can use `JSEventEmitter.current().fireNow(record)`. `emit` is a JS function
  (`JSEventEmitter.installEmit`) so that listeners of the calling thread and its ancestors may block (blocking the
  caller); listeners of unrelated threads, and every listener called by `fireNow` / `events/promises.emit` or by an
  `emit` inside `forEach` & co. (#38), cannot block. `@Event` holders outside core must be registered with `Events.register` (e.g. `PeripheralEvents` in
  `ModRegistry.register`), or scripts could emit them.
- Async model (#35): blocking stays the default. Every native module `x` also exists as `require('x/promises')` with
  the same functions returning real `Promise`s (`fooSync` + callback `foo` pairs collapse to a promise `foo`, as in
  Node's `fs/promises`); objects returned through it get promise methods too. Rhino's promise jobs run in the event
  loop's microtask queue (`JSMachine.CCContext.enqueueMicrotask` → `EventLoop.schedulePromiseJob`). A pending
  operation is parked like a blocking call, but with a `Waiter.Promised` instead of a continuation.
  `require('async')` has `run(function* () {…})` (yield = await) and `unwrap(p)` (block until settled);
  `require('tslib')` is native, so TS `async` functions, async generators and `for await` work (ROM tsconfig:
  `target: es2015` + `importHelpers`; `Symbol.asyncIterator` is polyfilled). Rhino has no `async`/`await` syntax,
  and Rhino's generator functions lack `Function.prototype` (use `Function.prototype.apply.call`).
- Promise reactions belong to the thread that registered them (`Promise.prototype.then` is wrapped, see `JSPromises`):
  a stopped thread's reactions never run. A pending `/promises` operation of a stopped thread is discarded and its
  promise rejected with `Error("Terminated")`, so other threads awaiting it don't hang. Aborts inside promise code are
  noted by the event loop (`EventLoop.noteAbort`), as Rhino's promise machinery catches them.
- Unhandled rejections (`EventLoop.checkRejections`): a rejection without a handler at the end of a microtask drain
  fails the thread that created the promise with `Error("Unhandled promise rejection: …")` (Node ≥ 15 semantics; bash
  prints it like any program error). If that thread is the root thread or already returned, the error goes to the
  `unhandled_rejection` event (bash prints it); a stopped thread's promises never report. Rhino's own
  `UnhandledRejectionTracker` is unusable (static map shared by all computers), so the global `Promise` is a wrapper
  that reports every new promise.
- Programs are loaded with `require.uncached` (fresh every run); libraries use the cached `require`.
- `fs` follows Node.js semantics and signatures (options objects, `withFileTypes`, `recursive`, Node error codes);
  CC-specific calls (`getDrive`, `getFreeSpace`, …) are extensions.
- Sandbox: `initSafeStandardObjects` + deny-all `ClassShutter`; the allowed globals are pinned by `JSSandboxTest`.

## Conventions

- **Rhino authoring constraints** for all ROM/bios TS: no `const` inside loops/blocks (use `let`), no spread in calls
  or array literals (use `.concat()` / `.apply()`). TS targets ES2015 (`async` → generators + native `tslib`),
  CommonJS (`export = {...}`). No `class` syntax (use constructor functions + prototypes). Functions that may be
  called through `Function.prototype.apply` must not use rest parameters (Rhino 1.9.1 passes `[thisArg, argsArray]`
  as the rest array) — read `arguments` instead. Avoid local variables named after `Object.prototype` members
  (`constructor`, `toString`, …): in `util.ts` a `let constructor` resolved to `Object`. In plain JS generators (`async.run`), parenthesize `yield` inside expressions
  (`f((yield p))`, `x = (yield p), y`).
- Programs in `rom/bin` / `rom/os/bin` export `main(args, cwd)` (same as `process.argv.slice(2)` /
  `process.cwd()`); bash calls it, or just runs the module's top-level code (Node style). Line-oriented programs use
  `readline` / `process.stdin`; full-screen programs (`edit`) may still listen to raw `char`/`key` events — bash
  pauses its own interface while a program runs. ROM code cannot use `class` syntax (Rhino): Node-style classes
  (`Console`, `readline.Interface`, the internal `EventEmitter`) are constructor functions with prototypes.
- New source files carry the MPL-2.0 SPDX header (`average-web-dev`, current year).
- Java style follows the surrounding upstream code (jspecify `@Nullable`, `var`, records).
- After changing `@ScriptFunction` signatures, regenerate types (`:common:generateTsTypes`) and fix ROM TS errors.

## Git workflow

- Conventional commits: `feat(scope): …`, `fix(…)`, `refactor(…)`, `docs(…)`; scopes in use: `js-engine`,
  `event-loop`, `turtle`, `rom`, `bash`, `api`, `types`, `tsdoclet`, `build`.
- Stage files explicitly (no `git add .`). **Propose the commit message and wait for the user's approval before
  committing.** Every AI-generated commit carries a `Co-Authored-By: Claude … <noreply@anthropic.com>` trailer.
- Do not push or open PRs unless asked.
- Commits are signed through the 1Password SSH agent. If signing fails ("1Password: agent returned an error"), do
  **not** disable signing — stage the work, keep the commit message ready and ask the user to unlock 1Password.

## Known open problems

Tracked as GitHub issues on `average-web-dev/CC-Rhino` (labels `security`, `bug`, `todo`, `enhancement`).
Check `gh issue list --repo average-web-dev/CC-Rhino` before starting work so you don't duplicate effort.
