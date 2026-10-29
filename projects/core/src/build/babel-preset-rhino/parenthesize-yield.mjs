// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

/**
 * Wrap every `yield` expression in parentheses.
 *
 * Rhino's parser rejects a `yield` expression directly in an argument list or after a comma ("yield expression must
 * be parenthesized"), and parses the operand of `yield` as a whole comma expression, so lowered `await`s such as
 * `_j = yield it.next(), _a = _j.done` would run `_a = _j.done` before yielding. Parentheses never change the meaning
 * of a `yield` (it has the lowest precedence), so wrapping all of them is safe.
 *
 * This runs when the whole program has been visited (Program exit), after the other plugins' transforms, so that no
 * other plugin sees the ParenthesizedExpression nodes.
 *
 * @param {import("@babel/core")} babel
 */
export default function parenthesizeYield({ types: t }) {
    return {
        name: "rhino-parenthesize-yield",
        visitor: {
            Program: {
                exit(program) {
                    program.traverse({
                        // On exit, so nested yields (`yield yield x`) are wrapped first. The replacement is visited
                        // again, but then its yield's parent is the new parentheses.
                        YieldExpression: {
                            exit(path) {
                                if (path.parentPath.isParenthesizedExpression()) return;
                                path.replaceWith(t.parenthesizedExpression(path.node));
                            },
                        },
                    });
                },
            },
        },
    };
}
