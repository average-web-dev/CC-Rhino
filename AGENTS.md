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
./gradlew :forge:runClient / :fabric:runClient   # in-game testing
```

CI only runs the mod build + tests (Lua lint/docs website/TeaVM web emulator are currently disabled, see `TODO(rhino)`).

## Where things live

| Area | Path |
|---|---|
| JS machine (Rhino context, safepoint, sandbox) | `projects/core/src/main/java/dan200/computercraft/core/engine/JSMachine.java` |
| Event loop (timers / IO / microtasks / yields / setImmediate) | `core/engine/EventLoop.java` |
| `require()` resolver + module cache | `core/engine/JSRequire.java` (+ `REQUIRE_SETUP_JS` in `JSMachine`) |
| Java ⇄ JS value conversion | `core/engine/JSValues.java`, `JSArguments.java` |
| Java method → JS function, continuation capture | `core/engine/JSMethodBridge.java`, `JSAPIBuilder.java` |
| Event bus (`events.on/once/off`) | `core/engine/JSEventEmitter.java`, `core/apis/EventsAPI.java` |
| Core APIs (`fs`, `system`, `term`, `http`, `peripheral`, `redstone`) | `projects/core/src/main/java/dan200/computercraft/core/apis/` |
| Scripting API for addon mods (`@ScriptFunction`, `MethodResult`, `Result`, `TaskCompletion`) | `projects/core-api/src/main/java/dan200/computercraft/api/scripting/` |
| Turtle API + command queue | `projects/common/.../shared/turtle/apis/TurtleAPI.java`, `turtle/core/TurtleBrain.java` |
| Turtle energy (FE / Tech Reborn Energy) | `forge|fabric/.../shared/turtle/TurtleEnergyStorage.java`, `TurtleBrain.pushEnergy` |
| TypeScript → `.d.ts` generator | `projects/tsdoclet/` |
| ROM (TypeScript, transpiled to `/rom`, bios to `bios.js`) | `projects/core/src/ts/` (`bios.ts`, `rom/os`, `rom/bin`, `rom/os/bin`, `rom/lib`, `types/`) |
| Legacy Lua ROM (reference only, not shipped to the JS machine) | `projects/core/src/main/resources/data/computercraft/lua/` |

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
- Return values: one value per call. Can-fail actions return a `Result` record (`{ ok, reason? }`); structured data
  should be Java **records** (converted by reflection in `JSValues.toJs`, field names = component names).
  Real errors are thrown (`ScriptException`).
- Continuations only work when JS is entered via `executeScriptWithContinuations` / `callFunctionWithContinuations`.
  A JS callback invoked directly from Java (`fn.call(...)`) **cannot** call blocking APIs.

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

## Known open problems

Tracked as GitHub issues on `average-web-dev/CC-Rhino` (labels `security`, `bug`, `todo`, `enhancement`).
Check `gh issue list --repo average-web-dev/CC-Rhino` before starting work so you don't duplicate effort.
