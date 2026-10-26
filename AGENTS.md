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
| Safepoint aborts, resource limits | `core/engine/JSAbort.java`, `JSLimits.java`, `core/CoreConfig.java` (+ `ConfigSpec`) |
| Event bus (`events.on/once/off`) | `core/engine/JSEventEmitter.java`, `core/apis/EventsAPI.java` |
| Core APIs (`fs`, `system`, `term`, `http`, `peripheral`, `redstone`) | `projects/core/src/main/java/dan200/computercraft/core/apis/` |
| Scripting API for addon mods (`@ScriptFunction`, `MethodResult`, `Result`, `TaskCompletion`) | `projects/core-api/src/main/java/dan200/computercraft/api/scripting/` |
| Turtle API + command queue | `projects/common/.../shared/turtle/apis/TurtleAPI.java`, `turtle/core/TurtleBrain.java` |
| Turtle energy (FE / Tech Reborn Energy) | `forge|fabric/.../shared/turtle/TurtleEnergyStorage.java`, `TurtleBrain.pushEnergy` |
| TypeScript → `.d.ts` generator | `projects/tsdoclet/` |
| ROM (TypeScript, transpiled to `/rom`, bios to `bios.js`) | `projects/core/src/ts/` (`bios.ts`, `rom/os`, `rom/bin`, `rom/os/bin`, `rom/lib`, `types/`) |
| Legacy Lua ROM (reference only, not shipped to the JS machine) | `projects/core/src/main/resources/data/computercraft/lua/` |
| Core test harness (runs `/test.js` on a real computer) | `projects/core/src/test/java/dan200/computercraft/core/computer/ComputerBootstrap.java` |
| Engine unit tests (`JSMachineBuilder` + `Recorder` probe API) | `projects/core/src/test/java/dan200/computercraft/core/engine/` |
| Gametest mod (JS test programs, structures, Kotlin tests) | `projects/common/src/testMod/` |

## Runtime model (short)

- `require` is the **only** injected global (bios additionally sets `print`/`write`). Every API is a native module:
  `require('fs')`, `require('system')`, `require('events')`, `require('turtle')` … Native modules only exist when
  the hardware is present (e.g. `turtle` only on turtles).
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
  `JSScheduler.callLater` instead. Blocking APIs also fail inside generators (Rhino resumes them through Java).
- Concurrency: `require('parallel')` is native (green threads). Every parked continuation, listener, microtask and
  `setImmediate` belongs to a thread; stopping a thread discards them. Ctrl+T raises `Error("Terminated")` in the
  foreground program; bash runs each program as a foreground thread. There is deliberately **no** public
  `pullEvent`/`queueEvent`.
- Rhino `Promise` jobs are not drained by the event loop yet, so `.then` callbacks never run. The planned async model
  is `require('<module>/promises')` (#35); there is no `async`/`await` in Rhino.
- Programs are loaded with `require.uncached` (fresh every run); libraries use the cached `require`.
- `fs` follows Node.js semantics and signatures (options objects, `withFileTypes`, `recursive`, Node error codes);
  CC-specific calls (`getDrive`, `getFreeSpace`, …) are extensions.
- Sandbox: `initSafeStandardObjects` + deny-all `ClassShutter`; the allowed globals are pinned by `JSSandboxTest`.

## Conventions

- **Rhino authoring constraints** for all ROM/bios TS: no `const` inside loops/blocks (use `let`), no spread in calls
  or array literals (use `.concat()` / `.apply()`). TS targets ES2017, CommonJS (`export = {...}`).
- Programs in `rom/bin` / `rom/os/bin` export `main(args, cwd)`; bash calls it. Interactive programs suspend bash's
  `char`/`key` listeners and register their own.
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
