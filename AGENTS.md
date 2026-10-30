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
| [JS_MIGRATION.md](JS_MIGRATION.md) | Phase-by-phase migration plan + checklists, event-loop model, modern syntax on Rhino (#47) |
| [JS_API_REDESIGN.md](JS_API_REDESIGN.md) | Target JS API surface per module (`fs`, `system`, `events`, `turtle`, …) |
| [JS_ROM_FEATURES.md](JS_ROM_FEATURES.md) | Feature spec for every ROM library/program to port |
| [projects/ARCHITECTURE.md](projects/ARCHITECTURE.md) | Upstream module layout (core / common / forge / fabric) |

The checklists in `JS_MIGRATION.md` sometimes lag behind the code — verify against the source and tick items off
when you finish them.

## Build & test

JDK 25 is required (`JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64`), plus Node ≥ 20 for `tsc` and Babel (`npm ci`).

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

- Rhino is built from the Git branch `average-web-dev/rhino@rhino_1_9_backports` (1.9.x plus backported fixes),
  not the Maven artifact: `rhinoGit`/`rhinoBranch` in `gradle.properties` (Gradle source dependency, cloned into
  `.gradle/vcs-1`; fetch new commits with `--refresh-dependencies`). `-PrhinoDir=<path>` uses a local checkout instead.
  The engine's workarounds (`babel-preset-rhino`, `JSRhinoFeatureTest`) are tuned to that branch.
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
- The ROM, the TS test fixtures and user projects are compiled by `projects/core/src/build/compile-ts.mjs
  --project <tsconfig>` (#47, #49): tsc **only type-checks** (the ROM tsconfig sets `noEmit`, `module: preserve`,
  `esModuleInterop`, `isolatedModules`, `useDefineForClassFields`), then Babel compiles each file on its own:
  `@babel/preset-typescript` strips the types (type-only imports are elided), then **`babel-preset-rhino`**
  (`src/build/babel-preset-rhino/`) applies exactly the transforms Rhino needs (`async` functions, async
  generators and `for await` → native generators driven by `asyncToGenerator`/`wrapAsyncGenerator` — never
  regenerator; class fields/`#private`/static blocks, classes, block scoping in
  loops, spread in calls/`new`, destructuring, `new.target`, ES modules → CommonJS
  (`modules.mjs`), plus its own plugins that
  parenthesize every `yield` and make leaving a `for-of` early close the iterator (`for-of.mjs`: the loop stays
  native over an iterator obtained by the `rhinoForOf` helper, wrapped in `try`/`finally` — never `catch`, which
  halves the interpreter's speed for the whole function — with arrays iterated as is). Babel's runtime helpers are not inlined: files
  get `var _babelHelpers = require("babel-helpers")`, a native engine module (`JSBabelHelpers`) generated at build time
  from `@babel/helpers` by `:core:generateBabelHelpers` (`babel-preset-rhino/helpers.mjs`: the shipped helper list +
  Rhino fixes); a helper outside that list fails the build. Non-module files (the bios) use `require("babel-helpers").x`
  inline, so they declare no globals. Source maps (`sourceMap`/`inlineSourceMap`) map straight to the `.ts` files.
  Output paths follow `outDir`/`rootDir` like tsc's; `noEmitOnError` is honoured. `tslib` stays a native module for
  TS compiled elsewhere.
- **Module syntax (#49):** sources use ES modules. Native modules (`declare module "fs" { export = … }`):
  `import fs from 'fs'` (canonical; `esModuleInterop` + `interopRequireDefault`), `import * as fs from 'fs'`, and
  `import { readFileSync } from 'fs'` all work. ROM libraries have **named exports only**, so plain-JS `require('util')`
  returns the same object as before (no `default`, no `__esModule`; `StdioLibraryTest.exports` pins every ROM
  module's keys). Interop rules (`babel-preset-rhino/modules.mjs`, `helpers.mjs`): CommonJS `strict` mode — the
  `__esModule` flag is only set for a module with a default export, so a default import of any other module is its
  `module.exports` (Node semantics, matching the `export =` typings); a namespace import of a CommonJS module is an
  object inheriting from it with `default` = the module (the engine's `interopRequireWildcard`, no copying). Named
  imports are live bindings (`(0, _m.f)(…)`). Exceptions: `console` and `process` assign `module.exports = …` (the
  module *is* the object, as in Node; ROM code imports them as `import proc from 'process'`, typed by the ambient
  declarations), and `readline.promises` / `timers.promises` are lazy getters defined on `exports`
  (`export declare const promises` types them). TypeScript's `import x = require()` / `export =` are rejected where the
  tsconfig has `"ccRhino": { "esModuleSyntaxOnly": true }` (ROM, tests; not inherited through `extends`); user
  projects may still use them (Babel compiles them to `require` / `module.exports`). ROM tests import ROM internals
  with plain `require('/rom/lib/…')` (an `import` would pull the ROM source into the test program).
  Babel is a build-time npm devDependency only; the jar ships compiled JS. `JSRhinoFeatureTest` pins Rhino's feature
  matrix (native vs. transformed, snippets per feature) and runs the compiled fixtures in `src/test/ts/features/`.
- Test programs are TypeScript too, type-checked (ROM strictness) against the ROM types and the generated `.d.ts`, and
  compiled by the same pipeline. Write new ones in TS, not JS:
  - `projects/core/src/test/ts/` → `:core:transpileTestTypeScript` → `build/generated/testJs`, on the test classpath as
    `ts-fixtures/…`. Engine fixtures (`async.ts`, …) and the ROM library tests in `stdio/` (`StdioLibraryTest` mounts
    `stdio/prelude.js` next to each program as `/test.js`; `stdio/bootstrap.d.ts` declares the test bios's `assert`).
  - `projects/common/src/testMod/ts/computer/` (`startup.ts`, `tests/<computer label>.ts`) →
    `:common:transpileTestModTypeScript` → `common/build/generated/testModJs/computer`, which the gametest runs copy
    onto the test computers (system property `cctest.computer-sources`; the `runGametest*`/`runTestClient` tasks
    depend on the transpile task). `types/test.d.ts` declares the gametest bios's `test` global.
  - JS snippets embedded in Java/Kotlin engine tests stay inline.

## Where things live

| Area | Path |
|---|---|
| JS machine (Rhino context, safepoint, sandbox) | `projects/core/src/main/java/dan200/computercraft/core/engine/JSMachine.java` |
| Event loop (timers / IO / microtasks / yields / setImmediate) | `core/engine/EventLoop.java` |
| Node timers (`setTimeout` & co., #45): native queue + `internal/loop` module, ROM `timers` / `timers/promises` | `core/engine/JSTimers.java`, `JSLoopModule.java`, `MachineTimers.java` (tick clock, `computer/Environment`), `src/ts/rom/lib/timers.ts`, `timers/promises.ts`; types `src/ts/types/timers.d.ts` |
| Job lifetime / keep-alive (#46): `EventLoop.isIdle`, `waitIdle`, keep-alive handles; bash job wait | `core/engine/EventLoop.java`, `JSLoopModule.java`, `src/ts/rom/lib/internal/tty.ts` (`waitForJob`), `rom/bin/bash.ts` |
| Green threads (`parallel` module), thread ownership/cancellation, Ctrl+T | `core/engine/JSParallel.java`, `JSThread.java`, `JSTaskGroup.java`, `EventLoop.java` |
| `require()` resolver + module cache (`require.uncached`, `require.resolve`) | `core/engine/JSRequire.java` (+ `REQUIRE_SETUP_JS` in `JSMachine`) |
| Java ⇄ JS value conversion (records, cycle-safe tables, `ArrayTable`) | `core/engine/JSValues.java`, `JSArguments.java` |
| Wrapping returned Java objects with script methods (handles, dynamic objects) | `core/engine/JSObjects.java` |
| Java method → JS function, continuation capture, errors thrown at the call site | `core/engine/JSMethodBridge.java`, `JSAPIBuilder.java`, `JSCallShim.java`, `JSErrors.java` |
| Deferring JS callbacks from native code onto the event loop (e.g. fs callbacks) | `core/engine/JSScheduler.java` |
| Promises: `/promises` modules, promise jobs, `async`/`tslib` modules, async-code detection | `core/engine/JSPromises.java`, `Waiter.java`, `JSAPIBuilder.java` (+ `EventLoop`) |
| Safepoint aborts, resource limits (Rhino `Context` limits for strings, `ArrayBuffer`s, `apply` arguments, stack depth, set in `CCContextFactory.makeContext`; native array loops reach the safepoint) | `core/engine/JSAbort.java`, `JSMachine.java`, `core/CoreConfig.java` (+ `ConfigSpec`) |
| Node-style stdio: `process`, `console`, `util`, `readline` (+`/promises`), terminal driver + job control | `projects/core/src/ts/rom/lib/` (`internal/tty.ts`, `internal/globals.ts`, `internal/emitter.ts`); types in `src/ts/types/{process,console,util,readline}.d.ts` |
| Event bus (`events.on/once/off/emit`, `fireNow`, native-name registry) | `core/engine/JSEventEmitter.java` (incl. the JS `emit`), `core/apis/EventsAPI.java`, `EventLoop.emitPlan`/`dispatchNow`, core-api `scripting/Events.java` |
| Core APIs (`fs`, `system`, `term`, `http`, `peripheral`, `redstone`) | `projects/core/src/main/java/dan200/computercraft/core/apis/` |
| Scripting API for addon mods (`@ScriptFunction`, `MethodResult`, `Result`, `TaskCompletion`) | `projects/core-api/src/main/java/dan200/computercraft/api/scripting/` |
| Turtle API + command queue | `projects/common/.../shared/turtle/apis/TurtleAPI.java`, `turtle/core/TurtleBrain.java` |
| Turtle energy (FE / Tech Reborn Energy) | `forge|fabric/.../shared/turtle/TurtleEnergyStorage.java`, `TurtleBrain.pushEnergy` |
| TypeScript → `.d.ts` generator | `projects/tsdoclet/` |
| TS → Rhino JS compiler (tsc type-check + Babel emit), `babel-preset-rhino`, native `babel-helpers` module | `projects/core/src/build/compile-ts.mjs`, `projects/core/src/build/babel-preset-rhino/`, `core/engine/JSBabelHelpers.java`; feature matrix: `core/engine/JSRhinoFeatureTest.java` + `src/test/ts/features/` |
| ROM (TypeScript, transpiled to `/rom`, bios to `bios.js`) | `projects/core/src/ts/` (`bios.ts`, `rom/os`, `rom/bin`, `rom/os/bin`, `rom/lib`, `types/`) |
| Legacy Lua ROM (reference only, not shipped to the JS machine) | `projects/core/src/main/resources/data/computercraft/lua/` |
| Core test harness (runs `/test.js` on a real computer) | `projects/core/src/test/java/dan200/computercraft/core/computer/ComputerBootstrap.java` |
| Interactive harness (real bios/ROM, type keys, read the screen) | `core/computer/TerminalHarness.java` (used by `StdioShellTest`, `StdioTerminalTest`); ROM library tests: `StdioLibraryTest` + `src/test/ts/stdio/*.ts` |
| Engine unit tests (`JSMachineBuilder` + `Recorder` probe API) | `projects/core/src/test/java/dan200/computercraft/core/engine/` |
| Gametest mod (TS test programs in `ts/computer/`, structures, Kotlin tests) | `projects/common/src/testMod/` |

## Runtime model (short)

- Globals, like Node: the engine injects only `require`; the bios adds `process`, `console`, the timer functions
  (`setTimeout`/`clearTimeout`/`setInterval`/`clearInterval`/`setImmediate`/`clearImmediate`) and `queueMicrotask`
  (`/rom/lib/internal/globals`, also `require('process')` / `require('console')` / `require('timers')`, same
  objects; the list is pinned by `JSSandboxTest.BIOS_GLOBALS`). There is no `print`/`write`: use `console.log` /
  `process.stdout.write`. There is no global `sleep`: `require('system').sleep(ticks)`. Every computer API is a native module:
  `require('fs')`, `require('system')`, `require('events')`, `require('turtle')` … Native modules only exist when
  the hardware is present (e.g. `turtle` only on turtles).
- Node-style stdio (#34) is ROM TypeScript in `/rom/lib`: `process`, `console`, `util`, `readline`,
  `readline/promises`. These "ROM core modules" resolve before `require.paths` and with a `node:` prefix
  (`JSRequire.ROM_CORE_MODULES`). `/rom/lib/internal/tty.ts` is the terminal driver: stdout/stderr write with VT
  semantics (wrapping, ANSI SGR colours → CC colours, cursor/erase CSI sequences; stderr in red); stdin turns
  `char`/`key`/`paste` into a Node TTY stream (cooked line discipline or raw VT sequences, `'keypress'` events). Its
  input listeners are registered by the bios (root thread) first; `process.stdin.on(...)` registers native listeners
  in the *calling* thread, so a program's stdin handlers may block and die with the program. bash runs each program
  as a job (`tty.beginJob/waitForJob/endJob`): fresh stdin, `process.argv`, cwd restored afterwards; see job
  lifetime below. `readline.Interface#question` without a callback **blocks**; `readline/promises` returns a promise (hand-written —
  the engine's generated `/promises` modules exist only for native modules).
- Timers (#45): `setTimeout` & co. are ROM TypeScript (`/rom/lib/timers`, `timers/promises`) over a native queue
  (`JSTimers`, via the engine-internal `internal/loop` module). Delays are rounded up to whole ticks (≥ 1 tick, so
  `setTimeout(cb, 0)` waits for the next tick); one CC timer per pending timer; timers due in the same tick run in
  due-time/creation order (`MachineTimers.start` reports the due tick, as CC queues same-tick `timer` events in
  hash order). Callbacks run in the creating thread (may block, discarded when it stops); they return a Node-like
  `Timeout` (`ref`/`unref`/`hasRef`/`refresh`/`close`, `Number(t)` = id).
- Job lifetime (#46): after a program's `main()` / top-level code returns, `tty.waitForJob` blocks in
  `internal/loop.waitIdle()` until the job's thread is idle (`EventLoop.isIdle`): no child threads and no *ref'd*
  pending work — blocked calls, pending `/promises` operations, queued immediates/microtasks, ref'd timers, ref'd
  keep-alive handles (`handle()`/`handleRef`/`handleClose`; tty holds one per `process.stdin` listener while stdin
  flows). Plain pending promises and `events.on` listeners don't count (Node semantics). If `main()` returned a
  thenable (`async main`, #44), its rejection is the program's error (exit code 1). `process.exit()` wakes the wait
  (`wakeIdle`). Then `waitForJob` throws the job-end signal (`tty.exitCodeOf` → `null` for a normal end), which
  *stops* the job's thread: everything it left behind (listeners, unref'd timers, reactions, spawned threads) is
  discarded and nothing runs after the prompt. Daemons that outlive their program are not supported yet.
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
  TS `async` functions, async generators and `for await` work: Babel lowers them to generators driven by the
  `babel-helpers` module (`Symbol.asyncIterator` is polyfilled); `require('tslib')` is native too, for TS compiled
  elsewhere (`importHelpers`; it also has the `#private` helpers). Rhino has no `async`/`await` syntax. Generator functions inherit
  from `Function.prototype` only because the global scope is a `TopLevel` (`JSMachine`; without it Rhino never creates
  the hidden `GeneratorFunction`).
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

- **Writing ROM/test TS:** modern syntax works (#47): `class` (fields, `#private`, static blocks, `extends Error`/`Map`),
  `const`/`let` anywhere, spread, rest/default parameters (native), destructuring,
  `new.target`, `async`/`await` — Babel (`babel-preset-rhino`) rewrites what Rhino gets wrong. ES module syntax
  (`import fs from 'fs'`, named exports; see "Module syntax" above). Type-only imports may use `import type`.
  Leaving a `for-of` early closes the iterator (a generator's
  `finally` runs). What is left: decorators and `using` are unsupported (a missing
  helper fails the build). Hand-written JS that bypasses the pipeline (Java text blocks, engine-test snippets) still
  has to respect Rhino: no `class`, no spread in calls, no `const` in loops, `for-of` never closes its iterator,
  parenthesize `yield` inside expressions (`f((yield p))`).
- Programs in `rom/bin` / `rom/os/bin` export `main(args, cwd)` (`export function main…`; same as
  `process.argv.slice(2)` / `process.cwd()`); bash calls it, or just runs the module's top-level code (Node style).
  `main` may be `async`
  (return a promise); the exit code is `process.exitCode`, not `main`'s return value. Line-oriented programs use
  `readline` / `process.stdin`; full-screen programs (`edit`) may still listen to raw `char`/`key` events — bash
  pauses its own interface while a program runs. Node-style classes (`Console`, `readline.Interface`, the internal
  `EventEmitter`, `Timeout`/`Immediate`) are real `class`es; `Console` and the readline `Interface`s are exported
  through `/rom/lib/internal/callable`, so that, as in Node, they also work without `new`.
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
