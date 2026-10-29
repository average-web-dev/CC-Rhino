// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Compile a TypeScript project for Rhino: like `tsc --project <tsconfig>`, followed by Babel with babel-preset-rhino.
//
// 1. tsc type-checks and emits ES2015 CommonJS (the project's own compiler options; the ROM's tsconfig sets
//    `target: es2015` + `importHelpers`). This lowers everything newer than ES2015 — async functions and generators
//    (to generators driven by the native `tslib`), class fields, #private, optional chaining, … — and handles the
//    TypeScript-only module forms (`export =`, `import x = require()`).
// 2. Babel with babel-preset-rhino (./babel-preset-rhino) rewrites the ES2015 that Rhino lacks or gets wrong: classes,
//    block scoping in loops, spread in calls, rest parameters, destructuring, new.target, unparenthesized `yield`.
//    Its runtime helpers come from the engine's native `babel-helpers` module.
//
// tsc's output is kept in memory and only written once Babel has processed it. Source maps (`sourceMap` or
// `inlineSourceMap`) are carried through both steps.
//
// Usage: npx tsx src/build/compile-ts.mjs --project <tsconfig.json>

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { transformSync } from "@babel/core";
import ts from "typescript";
import babelPresetRhino from "./babel-preset-rhino/index.mjs";

const projectIndex = process.argv.indexOf("--project");
if (projectIndex < 0 || projectIndex + 1 >= process.argv.length) {
    process.stderr.write("Usage: compile-ts.mjs --project <tsconfig.json>\n");
    process.exit(2);
}

const formatHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
};

function report(diagnostics) {
    if (diagnostics.length > 0) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
}

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

const program = ts.createProgram({
    rootNames: config.fileNames,
    options: config.options,
    projectReferences: config.projectReferences,
});
const diagnostics = [...ts.getPreEmitDiagnostics(program)];

/** @type {Map<string, { text: string, script: boolean }>} tsc's output, by file name. */
const outputs = new Map();
const result = program.emit(undefined, (fileName, text, _writeByteOrderMark, _onError, sourceFiles) => {
    // A source file that is not a module (e.g. the bios) runs in the global scope: Babel must not add top-level
    // declarations to it.
    const script = sourceFiles !== undefined && sourceFiles.length > 0 && !ts.isExternalModule(sourceFiles[0]);
    outputs.set(fileName, { text, script });
});
diagnostics.push(...result.diagnostics);

const sourceMappingURL = /\n?\/\/# sourceMappingURL=\S*\s*$/;

for (const [fileName, { text, script }] of outputs) {
    if (!/\.[cm]?js$/.test(fileName)) continue;

    const mapFile = fileName + ".map";
    const separateMap = outputs.get(mapFile);
    const inlineMap = config.options.inlineSourceMap === true;
    let transformed;
    try {
        transformed = transformSync(separateMap ? text.replace(sourceMappingURL, "") : text, {
            filename: fileName,
            babelrc: false,
            configFile: false,
            sourceType: script ? "script" : "commonjs",
            presets: [babelPresetRhino],
            comments: true,
            compact: false,
            inputSourceMap: separateMap ? JSON.parse(separateMap.text) : inlineMap,
            sourceMaps: separateMap ? true : inlineMap ? "inline" : false,
        });
    } catch (e) {
        diagnostics.push({
            category: ts.DiagnosticCategory.Error,
            code: 0,
            file: undefined,
            start: undefined,
            length: undefined,
            messageText: `Babel failed on ${fileName}: ${e.message}`,
        });
        continue;
    }

    let code = transformed.code + "\n";
    if (separateMap) {
        const map = { ...transformed.map, file: path.basename(fileName) };
        outputs.set(mapFile, { text: JSON.stringify(map), script: false });
        code += `//# sourceMappingURL=${path.basename(mapFile)}\n`;
    }
    outputs.set(fileName, { text: code, script });
}

const failed = diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error);
// With noEmitOnError, the emit result repeats the pre-emit diagnostics.
report(ts.sortAndDeduplicateDiagnostics(diagnostics));
if (!failed || !config.options.noEmitOnError) {
    for (const [fileName, { text }] of outputs) {
        fs.mkdirSync(path.dirname(fileName), { recursive: true });
        fs.writeFileSync(fileName, text);
    }
}
process.exit(failed ? 1 : 0);
