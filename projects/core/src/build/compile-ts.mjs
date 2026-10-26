// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Compile a TypeScript project like `tsc --project <tsconfig>`, with one extra transform for Rhino.
//
// tsc compiles `await x` to `yield x` (target es2015), so `f(await x)` becomes `f(yield x)`, and async generators
// produce `__await(yield …)`. Rhino's parser rejects a `yield` expression directly in an argument list or after a
// comma ("yield expression must be parenthesized"), and parses the operand of `yield` as a whole comma expression.
// The transform below, which runs after tsc's own transforms, therefore wraps every `yield` in parentheses.
//
// Usage: npx tsx src/build/compile-ts.mjs --project <tsconfig.json>

import process from "node:process";
import ts from "typescript";

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

/**
 * Wrap every `yield` expression in parentheses. Besides rejecting unparenthesized `yield` in argument lists, Rhino
 * parses the operand of `yield` as a whole comma expression, so tsc's `for await` output
 * `_j = yield it.next(), _a = _j.done` would run `_a = _j.done` before yielding. Parentheses never change the meaning
 * of a `yield` (it has the lowest precedence), so wrapping all of them is safe.
 */
function parenthesizeYields(context) {
    const { factory } = context;

    function visit(node) {
        if (ts.isParenthesizedExpression(node) && ts.isYieldExpression(node.expression)) {
            return factory.updateParenthesizedExpression(node, ts.visitEachChild(node.expression, visit, context));
        }
        node = ts.visitEachChild(node, visit, context);
        return ts.isYieldExpression(node) ? factory.createParenthesizedExpression(node) : node;
    }

    return (sourceFile) => ts.visitNode(sourceFile, visit);
}

const program = ts.createProgram({
    rootNames: config.fileNames,
    options: config.options,
    projectReferences: config.projectReferences,
});
const diagnostics = [...ts.getPreEmitDiagnostics(program)];
const result = program.emit(undefined, undefined, undefined, false, { after: [parenthesizeYields] });
diagnostics.push(...result.diagnostics);
report(diagnostics);
process.exit(diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error) ? 1 : 0);
