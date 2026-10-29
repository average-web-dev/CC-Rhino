// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Compile a TypeScript project for Rhino: type-check it with tsc, emit it with Babel.
//
// - tsc type-checks the project (its tsconfig's compiler options, without emitting anything: the ROM's tsconfig sets
//   `noEmit`, so that a plain `tsc -p` or an editor only checks).
// - Babel compiles every source file of the project on its own: @babel/preset-typescript strips the types, then
//   babel-preset-rhino (./babel-preset-rhino) lowers what Rhino lacks or gets wrong (async functions, classes, block
//   scoping in loops, spread in calls, …) and turns ES modules into CommonJS. Its runtime helpers come from the
//   engine's native `babel-helpers` module.
//
// The two run in parallel: Babel in a worker thread, which starts loading Babel right away and compiles the files as
// soon as tsc has parsed the project, while tsc checks it.
//
// Output files go where tsc would put them (`outDir` / `rootDir`), with source maps if the tsconfig asks for them
// (`sourceMap` or `inlineSourceMap`, mapping straight to the .ts sources). As with tsc, `noEmitOnError` writes nothing
// when there are errors.
//
// Projects write ES module syntax (`import fs from "fs"`, `export function main…`). TypeScript's CommonJS forms
// (`import x = require("x")`, `export =`) still compile, unless the tsconfig opts out of them with a top-level
// `"ccRhino": { "esModuleSyntaxOnly": true }` (the ROM and the tests do; the option is not inherited through
// `extends`).
//
// Usage: npx tsx src/build/compile-ts.mjs --project <tsconfig.json>

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
    await main();
} else {
    await babelWorker();
}

/**
 * @typedef {{ fileName: string, text: string, outFile: string, module: boolean }} Source A file to compile.
 * @typedef {{ sources: Source[], sourceMaps: boolean | "inline", inlineSources: boolean }} Job
 * @typedef {{ outputs: [string, string][], errors: string[] }} Result Output files with their contents.
 */

/** The worker: compile the files it is sent with Babel. */
async function babelWorker() {
    const { transformSync } = await import("@babel/core");
    const { default: presetTypescript } = await import("@babel/preset-typescript");
    const { default: babelPresetRhino } = await import("./babel-preset-rhino/index.mjs");

    parentPort.once("message", (/** @type {Job} */ { sources, sourceMaps, inlineSources }) => {
        /** @type {Result} */
        const result = { outputs: [], errors: [] };
        for (const { fileName, text, outFile, module } of sources) {
            let transformed;
            try {
                transformed = transformSync(text, {
                    filename: fileName,
                    sourceFileName: path.relative(path.dirname(outFile), fileName).split(path.sep).join("/"),
                    babelrc: false,
                    configFile: false,
                    // A file that is not a module (e.g. the bios) runs in the global scope: Babel must not add
                    // top-level declarations to it.
                    sourceType: module ? "module" : "script",
                    // Presets run last to first: types are stripped before the Rhino transforms.
                    presets: [babelPresetRhino, presetTypescript],
                    comments: true,
                    compact: false,
                    sourceMaps,
                });
            } catch (e) {
                result.errors.push(`Babel failed on ${fileName}: ${e.message}`);
                continue;
            }

            let code = transformed.code + "\n";
            if (sourceMaps === true) {
                const mapFile = outFile + ".map";
                const map = { ...transformed.map, file: path.basename(outFile) };
                if (!inlineSources) delete map.sourcesContent;
                result.outputs.push([mapFile, JSON.stringify(map)]);
                code += `//# sourceMappingURL=${path.basename(mapFile)}\n`;
            }
            result.outputs.push([outFile, code]);
        }
        parentPort.postMessage(result);
    });
}

async function main() {
    const projectIndex = process.argv.indexOf("--project");
    if (projectIndex < 0 || projectIndex + 1 >= process.argv.length) {
        process.stderr.write("Usage: compile-ts.mjs --project <tsconfig.json>\n");
        process.exit(2);
    }

    // Start the worker first: it loads Babel while we load tsc.
    const worker = new Worker(new URL(import.meta.url));
    /** @type {Promise<Result>} */
    const babelResult = new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`The Babel worker exited with code ${code}`)));
    });
    // Unexpected failures surface when awaited, not as an unhandled rejection before that.
    babelResult.catch(() => {});

    const { default: ts } = await import("typescript");

    const formatHost = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
    };
    const report = (diagnostics) => {
        if (diagnostics.length === 0) return;
        process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
    };
    const error = (file, node, messageText) => ({
        category: ts.DiagnosticCategory.Error,
        code: 0,
        file,
        start: node?.getStart(file),
        length: node ? node.getEnd() - node.getStart(file) : undefined,
        messageText,
    });

    const config = ts.getParsedCommandLineOfConfigFile(process.argv[projectIndex + 1], {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            report([diagnostic]);
            process.exit(1);
        },
    });
    if (config.errors.length > 0) {
        report(config.errors);
        process.exit(1);
    }
    const options = config.options;

    // Parse the project (resolving its imports), without emitting anything.
    const program = ts.createProgram({
        rootNames: config.fileNames,
        options: { ...options, noEmit: true },
        projectReferences: config.projectReferences,
    });

    // The source files Babel compiles (what tsc would emit): no declaration files, nothing from node_modules. Files
    // outside the tsconfig's "include" that are imported anyway are emitted too, as tsc does.
    const ignoreCase = !ts.sys.useCaseSensitiveFileNames;
    const sources = program.getSourceFiles().filter((file) => !file.isDeclarationFile
        && !program.isSourceFileFromExternalLibrary(file) && !program.isSourceFileDefaultLibrary(file));
    /** @type {Source[]} */
    const jobs = [];
    for (const file of sources) {
        const commandLine = config.fileNames.includes(file.fileName) ? config
            : { ...config, fileNames: [...config.fileNames, file.fileName] };
        const outFile = ts.getOutputFileNames(commandLine, file.fileName, ignoreCase)
            .find((name) => /\.[cm]?js$/.test(name));
        if (outFile !== undefined) {
            jobs.push({ fileName: file.fileName, text: file.text, outFile, module: ts.isExternalModule(file) });
        }
    }
    worker.postMessage(/** @type {Job} */ ({
        sources: jobs,
        sourceMaps: options.inlineSourceMap ? "inline" : options.sourceMap ? true : false,
        inlineSources: options.inlineSources === true,
    }));

    // Type-check meanwhile.
    const diagnostics = [...ts.getPreEmitDiagnostics(program)];

    // TypeScript's CommonJS module forms: rejected where the project asks for ES module syntax only.
    if (config.raw?.ccRhino?.esModuleSyntaxOnly === true) {
        for (const file of sources) {
            for (const statement of file.statements) {
                if (ts.isImportEqualsDeclaration(statement)
                    && ts.isExternalModuleReference(statement.moduleReference)) {
                    diagnostics.push(error(file, statement,
                        "Use ES module syntax: `import x from \"m\"` (or `import * as x`, `import { a } from \"m\"`) " +
                        "instead of `import x = require(\"m\")`."));
                } else if (ts.isExportAssignment(statement) && statement.isExportEquals) {
                    diagnostics.push(error(file, statement,
                        "Use ES module syntax: named exports (`export function f…`, `export { a, b }`) instead of " +
                        "`export = …`. (A module whose value must be `module.exports` itself assigns " +
                        "`module.exports`.)"));
                }
            }
        }
    }

    const { outputs, errors } = await babelResult;
    diagnostics.push(...errors.map((message) => error(undefined, undefined, message)));

    const failed = diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error);
    report(ts.sortAndDeduplicateDiagnostics(diagnostics));
    if (!failed || !options.noEmitOnError) {
        for (const [fileName, text] of outputs) {
            fs.mkdirSync(path.dirname(fileName), { recursive: true });
            fs.writeFileSync(fileName, text);
        }
    }
    process.exit(failed ? 1 : 0);
}
