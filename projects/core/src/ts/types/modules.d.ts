// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Ambient module declarations, so `import x = require("x")` / `import * as x` also resolves.
// The `require(...)` call signatures in globals.d.ts cover the `const x = require("x")` style.

declare module "path" { const path: PathModule; export = path; }
declare module "env" { const env: EnvModule; export = env; }
declare module "parallel" { const parallel: ParallelModule; export = parallel; }
