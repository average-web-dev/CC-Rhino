<!--
SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers

SPDX-License-Identifier: MPL-2.0
-->

# Contributing to CC: Rhino
CC: Rhino is still at a very early stage and changing quickly, so **outside contributions are not being accepted yet**.
Please don't open pull requests for now, not even for open issues. Once things are more stable, contributions will be
very welcome and suitable issues will be opened for them.

Until then, this document describes how to build and test the mod yourself.

## Table of Contents
 - [Reporting issues](#reporting-issues)
 - [Setting up a development environment](#setting-up-a-development-environment)
 - [Developing CC: Rhino](#developing-cc-rhino)
 - [Writing documentation](#writing-documentation)

## Reporting issues
If you have a bug, suggestion, or other feedback, [file an issue][new-issue]. When doing so, do use the issue
templates - they provide a useful hint on what information to provide.

## Setting up a development environment
In order to build CC: Rhino, you'll need to download the source code and then run it.

 - Make sure you've got the following software installed:
   - Java Development Kit 25 (JDK). This can be downloaded from [Adoptium].
   - [Git](https://git-scm.com/).
   - [NodeJS 20 or later][node] (the ROM is written in TypeScript, type-checked with `tsc` and compiled with Babel).

 - Download CC: Rhino's source code:
   ```
   git clone https://github.com/average-web-dev/CC-Rhino.git
   cd CC-Rhino
   ```

 - Build CC: Rhino with `./gradlew build`. This will be very slow the first time it runs, as it needs to download a
   lot of dependencies (and decompile Minecraft several times). Subsequent runs should be much faster!

 - Running `./gradlew :forge:runClient` or `./gradlew :fabric:runClient` will start Minecraft under Forge and Fabric
   respectively.

If you want to run CC: Rhino in a normal Minecraft instance, run `./gradlew assemble` and copy the `.jar` from
`projects/forge/build/libs` (for Forge) or `projects/fabric/build/libs` (for Fabric).

## Developing CC: Rhino
Have a read of the following documents first:

 - [JS_MIGRATION.md](JS_MIGRATION.md): the migration plan from Lua to JavaScript, the event-loop model and the
   constraints for code running on Rhino.
 - [JS_API_REDESIGN.md](JS_API_REDESIGN.md): the target JavaScript API of each module (`fs`, `system`, `turtle`, …).
 - [JS_ROM_FEATURES.md](JS_ROM_FEATURES.md): the libraries and programs of the ROM.
 - [AGENTS.md](AGENTS.md): build commands, where things live and the runtime model in short.
 - [The architecture document][architecture]: the module layout inherited from CC: Tweaked.

The ROM (bios, os, bash, programs and libraries) is written in TypeScript in `projects/core/src/ts/`. Type
definitions for the native modules are generated from the Java javadoc with `./gradlew :common:generateTsTypes`.
It is compiled by `projects/core/src/build/compile-ts.mjs`: tsc only type-checks (the tsconfig sets `noEmit`), then
Babel strips the types and `babel-preset-rhino` (`projects/core/src/build/babel-preset-rhino/`) rewrites what Rhino
lacks (`async`/`await`, classes, spread in calls, block scoping in loops, …) and turns ES modules into CommonJS, so
modern TypeScript works as is. Node and the npm dev dependencies (`npm ci`) are only needed at build time.

The sources use ES module syntax, as in modern Node code:

```ts
import fs from 'fs';                            // a native module (also `import * as fs`, `import { readFileSync }`)
import { format } from 'util';                  // a ROM library
import * as tty from '/rom/lib/internal/tty';   // ROM-internal modules by path

export function main(args: string[], cwd: string): void { /* … */ }   // a program for bash
```

ROM libraries have named exports only, so plain JS still gets the same object from `require('util')`. TypeScript's
`import x = require()` / `export =` are rejected in the ROM and the tests (`"ccRhino": { "esModuleSyntaxOnly": true }`
in their tsconfigs); `console` and `process` are the module value themselves (`module.exports = …`), as in Node.

### Testing
CC: Rhino has several test suites, each designed to test something different:

 - The JavaScript engine (event loop, blocking calls, `require`, sandbox, resource limits, …) is tested by JUnit tests
   in `projects/core/src/test/java/dan200/computercraft/core/engine/`.

 - The builtin APIs are tested by running a JavaScript program (`/test.js`) on a real computer through
   `ComputerBootstrap` (`projects/core/src/test/java/dan200/computercraft/core/computer/`). These don't rely on any
   Minecraft code. Longer test programs, such as the ROM library tests run by `StdioLibraryTest`, are written in
   TypeScript under `projects/core/src/test/ts/` and compiled as part of the build.

   Both can be run with `./gradlew :core:test`.

 - In-game functionality, such as the behaviour of blocks, turtles and peripherals, is tested using [Minecraft's
   gametest system][mc-test] (`projects/common/src/testMod`). These tests spin up a server, spawn a structure for each
   test, and then run some code on the blocks defined in that structure, often a program from
   `projects/common/src/testMod/ts/computer/tests/` (TypeScript, named after the computer's label and compiled by
   `./gradlew :common:transpileTestModTypeScript`, which the gametest runs depend on).

   These tests can be run with `./gradlew runGametest` (or `./gradlew :forge:runGametest`/
   `./gradlew :fabric:runGametest` for a single loader).

## Writing documentation
The documentation website inherited from CC: Tweaked (`./gradlew docWebsite`) is currently disabled, as it is built
for the Lua API ([#17][docs-issue]). For now, the JavaScript API is documented in the javadoc of the Java API classes
(which also generates the TypeScript type definitions) and in the `JS_*.md` documents above.

[new-issue]: https://github.com/average-web-dev/CC-Rhino/issues/new/choose "Create a new issue"
[docs-issue]: https://github.com/average-web-dev/CC-Rhino/issues/17 "Re-enable the docs website"
[Adoptium]: https://adoptium.net/temurin/releases?version=25 "Download OpenJDK 25"
[mc-test]: https://www.youtube.com/watch?v=vXaWOJTCYNg
[node]: https://nodejs.org/en/ "Node.js"
[architecture]: projects/ARCHITECTURE.md
