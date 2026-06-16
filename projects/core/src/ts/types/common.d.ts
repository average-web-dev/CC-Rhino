// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Shared types used across the CC: Rhino API declarations.
// This file is a script (no top-level import/export), so all declarations are global.

/** One of the six sides of a computer. */
type Side = "top" | "bottom" | "left" | "right" | "front" | "back";

/** A CC colour, encoded as a single bit (1, 2, 4, … 0x8000) like the `colors` API. */
type Color = number;

/** Binary payloads are plain byte arrays. Aliased as `Buffer` for readability. */
type Buffer = Uint8Array;

/** Text encodings accepted by the filesystem API. */
type Encoding = "utf8" | "utf-8" | "binary" | "ascii" | "latin1";

/** Node-style error-first callback carrying a result. */
type Callback<T> = (err: Error | null, result: T) => void;

/** Node-style error-first callback with no result value. */
type ErrorCallback = (err: Error | null) => void;

/** Free-form detail tables returned by inspection/detail functions. */
type Details = Record<string, unknown>;
