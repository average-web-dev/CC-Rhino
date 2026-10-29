// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Ambient module declarations, so `import x from "x"` (and `import * as x`, `import { a } from "x"`) resolves.
// The `require(...)` call signatures in globals.d.ts cover the `const x = require("x")` style.

declare module "path" { const path: PathModule; export = path; }
declare module "env" { const env: EnvModule; export = env; }
declare module "parallel" { const parallel: ParallelModule; export = parallel; }
declare module "parallel/promises" { const parallelPromises: ParallelPromisesModule; export = parallelPromises; }
declare module "async" { const async: AsyncModule; export = async; }
