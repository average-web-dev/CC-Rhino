// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

pluginManagement {
    // Duplicated in buildSrc/build.gradle.kts
    repositories {
        mavenCentral()
        gradlePluginPortal()

        maven("https://maven.fabricmc.net/") {
            name = "Fabric"
            content {
                includeGroup("fabric-loom")
                includeGroup("net.fabricmc")
                includeGroup("net.fabricmc.unpick")
            }
        }

        maven("https://maven.squiddev.cc") {
            name = "SquidDev"
            content {
                includeGroup("cc.tweaked.vanilla-extract")
            }
        }
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version("0.8.0")
}

val mcVersion: String by settings
rootProject.name = "cc-rhino-$mcVersion"

include(":core-api")
include(":core")

include(":common-api")
include(":common")
include(":fabric-api")
include(":fabric")
include(":forge-api")
include(":forge")

include(":lints")
include(":tsdoclet")
include(":standalone")
include(":web")

for (project in rootProject.children) {
    project.projectDir = file("projects/${project.name}")
}

// Opt-in: build Rhino from a Git branch instead of the Maven artifact, e.g. to test a Rhino fork. Gradle clones it
// into .gradle/vcs-1 (new commits are fetched with --refresh-dependencies).
// ./gradlew :core:test -PrhinoGit=https://github.com/<user>/rhino.git -PrhinoBranch=<branch>
val rhinoGit = providers.gradleProperty("rhinoGit").orNull
if (rhinoGit != null) {
    val rhinoBranch = providers.gradleProperty("rhinoBranch").orNull ?: error("rhinoGit requires rhinoBranch")
    sourceControl {
        gitRepository(uri(rhinoGit)) {
            producesModule("org.mozilla:rhino")
        }
    }
    gradle.allprojects {
        configurations.configureEach {
            withDependencies {
                filterIsInstance<ExternalModuleDependency>()
                    .filter { it.group == "org.mozilla" && it.name == "rhino" }
                    .forEach { it.version { branch = rhinoBranch } }
            }
        }
    }
}

// Opt-in: build Rhino from a local checkout instead of the Maven artifact.
// ./gradlew :core:test -PrhinoDir=../rhino   (or set rhinoDir in ~/.gradle/gradle.properties)
providers.gradleProperty("rhinoDir").orNull?.let { dir ->
    includeBuild(dir) {
        dependencySubstitution {
            substitute(module("org.mozilla:rhino")).using(project(":rhino"))
        }
    }
}
