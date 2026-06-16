// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

import cc.tweaked.gradle.*

plugins {
    id("cc-tweaked.vanilla")
    id("cc-tweaked.illuaminate")
    id("cc-tweaked.mod")
    id("cc-tweaked.publishing")
}

minecraft {
    accessWideners(
        "src/main/resources/computercraft.accesswidener",
        "src/main/resources/computercraft-common.accesswidener",
    )
}

configurations {
    register("tsDoclet")
}

repositories {
    exclusiveContent {
        forRepositories(maven("https://maven.neoforged.net/releases"))
        filter {
            includeModule("org.spongepowered", "mixin")
        }
    }
}

dependencies {
    // Pull in our other projects. See comments in MinecraftConfigurations on this nastiness.
    api(project(":core"))
    api(commonClasses(project(":common-api")))
    clientApi(clientClasses(project(":common-api")))

    compileOnly(libs.mixin)
    compileOnly(libs.mixinExtra)
    compileOnly(libs.bundles.externalMods.common)
    clientCompileOnly(variantOf(libs.emi) { classifier("api") })

    annotationProcessorEverywhere(libs.autoService)
    testFixturesAnnotationProcessor(libs.autoService)

    testImplementation(testFixtures(project(":core")))
    testImplementation(libs.bundles.test)
    testRuntimeOnly(libs.bundles.testRuntime)

    testImplementation(libs.jmh)
    testAnnotationProcessor(libs.jmh.processor)

    testModCompileOnly(libs.mixin)
    testModImplementation(testFixtures(project(":core")))
    testModImplementation(testFixtures(project(":common")))
    testModImplementation(libs.bundles.kotlin)

    testFixturesImplementation(testFixtures(project(":core")))

    "tsDoclet"(project(":tsdoclet"))
}

illuaminate {
    version = libs.versions.illuaminate
}

val generateTsTypes by tasks.registering(Javadoc::class) {
    description = "Generate TypeScript .d.ts declarations from @ScriptFunction methods."
    group = JavaBasePlugin.DOCUMENTATION_GROUP

    val sourceSets = listOf(sourceSets.main.get(), project(":core").sourceSets.main.get())
    for (sourceSet in sourceSets) {
        source(sourceSet.java)
        classpath += sourceSet.compileClasspath
    }

    val tsTypesDir = layout.buildDirectory.dir("tsTypes").get().asFile
    destinationDir = tsTypesDir
    doFirst { delete(tsTypesDir) } // remove stale outputs so renamed/removed types don't linger

    // Build the doclet (a project dependency) before running, and put it on the doclet path.
    val tsDoclet = configurations["tsDoclet"]
    dependsOn(tsDoclet)

    val options = options as StandardJavadocDocletOptions
    options.docletpath = tsDoclet.files.toList()
    options.doclet = "cc.tweaked.tsdoclet.TypeScriptDoclet"
    options.noTimestamp(false)

    javadocTool = javaToolchains.javadocToolFor { languageVersion = CCTweakedPlugin.JDK_VERSION }
}

val lintLua by tasks.registering(IlluaminateExec::class) {
    group = JavaBasePlugin.VERIFICATION_GROUP
    description = "Lint Lua (and Lua docs) with illuaminate"

    // Config files
    inputs.file(rootProject.file("illuaminate.sexp")).withPropertyName("illuaminate.sexp")
    // Sources
    inputs.files(rootProject.fileTree("doc")).withPropertyName("docs")
    inputs.files(project(":core").fileTree("src/main/resources/data/computercraft/lua")).withPropertyName("lua rom")

    args = listOf("lint")
    workingDir = rootProject.projectDir

    doFirst { if (System.getenv("GITHUB_ACTIONS") != null) println("::add-matcher::.github/matchers/illuaminate.json") }
    doLast { if (System.getenv("GITHUB_ACTIONS") != null) println("::remove-matcher owner=illuaminate::") }
}

fun MergeTrees.configureForDatagen(source: SourceSet, outputFolder: String) {
    output = layout.projectDirectory.dir(outputFolder)

    for (loader in listOf("forge", "fabric")) {
        mustRunAfter(":$loader:$name")
        source {
            input {
                from(project(":$loader").layout.buildDirectory.dir(source.getTaskName("generateResources", null)))
                exclude(".cache")
            }

            output = project(":$loader").layout.projectDirectory.dir(outputFolder)
        }
    }
}

val runData by tasks.registering(MergeTrees::class) {
    configureForDatagen(sourceSets.main.get(), "src/generated/resources")
}

val runExampleData by tasks.registering(MergeTrees::class) {
    configureForDatagen(sourceSets.examples.get(), "src/examples/generatedResources")
}

// We can't create accurate module metadata for our additional capabilities, so disable it.
project.tasks.withType(GenerateModuleMetadata::class.java).configureEach {
    isEnabled = false
}
