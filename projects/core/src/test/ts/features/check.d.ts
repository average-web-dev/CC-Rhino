// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The feature fixtures (run by JSRhinoFeatureTest) report each check through this global, which the test defines.
// Values are compared by their string form (strings quoted, arrays element-wise).
declare function check(label: string, actual: unknown, expected: unknown): void;
