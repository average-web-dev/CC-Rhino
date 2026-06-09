// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Ambient module declarations, so `import x = require("x")` / `import * as x` also resolves.
// The `require(...)` call signatures in globals.d.ts cover the `const x = require("x")` style.

declare module "fs" { const fs: FsModule; export = fs; }
declare module "path" { const path: PathModule; export = path; }
declare module "process" { const process: SystemModule; export = process; }
declare module "events" { const events: EventsModule; export = events; }
declare module "http" { const http: HttpModule; export = http; }
declare module "term" { const term: TermModule; export = term; }
declare module "redstone" { const redstone: RedstoneModule; export = redstone; }
declare module "rs" { const rs: RedstoneModule; export = rs; }
declare module "peripheral" { const peripheral: PeripheralModule; export = peripheral; }
declare module "turtle" { const turtle: TurtleModule; export = turtle; }
declare module "commands" { const commands: CommandsModule; export = commands; }
declare module "pocket" { const pocket: PocketModule; export = pocket; }
