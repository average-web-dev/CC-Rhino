// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// A javadoc doclet that emits TypeScript .d.ts declarations from @ScriptFunction methods.
// Depends only on the JDK's standard doclet API, so it is a plain Java project (no Minecraft
// convention plugin) — its jar is consumed via the :common `tsDoclet` configuration.

plugins {
    java
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(25) }
}
