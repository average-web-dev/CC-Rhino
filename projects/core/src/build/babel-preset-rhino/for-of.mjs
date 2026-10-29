// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

/**
 * Make leaving a `for…of` early close the iterator, as the spec requires (#41).
 *
 * Rhino 1.9.1 iterates natively, but never calls the iterator's `return()` when a loop is left by `break`, `return`,
 * a labelled `break`/`continue` to an outer statement, or an exception, so a generator's `finally` never runs and
 * iterators that hold resources leak.
 *
 * The loop stays a native for-of (Rhino's own iteration is the fastest there is in the interpreter), but over an
 * iterator the transform obtained itself, so that it can close it:
 *
 * ```js
 * for (const x of xs) { if (x) break; f(x); }
 * // becomes
 * {
 *   var _it = xs, _done = false;
 *   if (!Array.isArray(_it)) _it = h.rhinoForOf(_it);
 *   try {
 *     for (const x of _it) { if (x) { _done || (_done = true, h.rhinoForOfClose(_it)); break; } f(x); }
 *     _done = true;
 *   } finally {
 *     _done || h.rhinoForOfAbort(_it);
 *   }
 * }
 * ```
 *
 * - Arrays are iterated as they are: the array iterator has no `return()`, so there is nothing to close. (An array
 *   whose `Symbol.iterator` was replaced is still iterated with it, natively, but not closed.) The check is inline,
 *   as a function call costs more than the rest of a short loop in Rhino's interpreter.
 * - For anything else, `rhinoForOf` (in the `babel-helpers` module, see ./helpers.mjs) calls `Symbol.iterator` and
 *   returns the iterator (wrapped if it is not iterable itself), which the native loop then steps.
 * - Every `break`, `continue` and `return` in the body that leaves this loop first closes the iterator; errors from
 *   `return()` (or a non-object result) propagate, as for any completion that is not a throw.
 * - When the loop runs to its end the iterator is done and must not be closed (`_done = true` after the loop).
 * - Otherwise the loop was left by an exception: the `finally` block closes the iterator and ignores errors of
 *   `return()`, so the original exception wins. A `catch` clause would tell exceptions apart more precisely, but
 *   makes Rhino's interpreter run the whole enclosing function about twice as slowly; `try`/`finally` costs nothing.
 *
 * Remaining deviations from the spec: if the iterator's `next()` itself throws, `return()` is still called (with its
 * errors ignored; generators and built-in iterators ignore it once they failed); and when a generator suspended in
 * the loop body is closed from outside (`gen.return()`), errors of the inner iterator's `return()` are ignored.
 *
 * Loops are rewritten on exit, innermost first, so that a jump leaving several loops closes the inner iterator before
 * the outer one. `for await` is left alone: @babel/plugin-transform-async-generator-functions lowers it to a loop
 * that closes the iterator itself.
 *
 * @param {import("@babel/core")} babel
 */
export default function forOf({ types: t }) {
    return {
        name: "rhino-for-of",
        pre() {
            /** Iterator variables of rewritten loops: a for-of over one of them is not rewritten again. */
            this.iterators = new Set();
            /** Temporaries holding a return value: no need to copy them again when an outer loop is closed. */
            this.returnValues = new Set();
        },
        visitor: {
            ForOfStatement: {
                exit(path) {
                    const { node } = path;
                    if (node.await) return;
                    if (t.isIdentifier(node.right) && this.iterators.has(node.right.name)) return;
                    // Statically an array (a literal, or a constant initialised with one): nothing to close.
                    if (path.get("right").isGenericType("Array")) return;

                    const scope = path.scope;
                    const it = scope.generateUidIdentifier("it");
                    const done = scope.generateUidIdentifier("done");
                    this.iterators.add(it.name);
                    const clone = t.cloneNode;

                    // Labels on the loop stay on it.
                    const ownLabels = new Set();
                    let outer = path;
                    while (outer.parentPath.isLabeledStatement()) {
                        outer = outer.parentPath;
                        ownLabels.add(outer.node.label.name);
                    }

                    // `_done || (_done = true, h.rhinoForOfClose(_it));`
                    const close = () => t.expressionStatement(t.logicalExpression("||", clone(done),
                        t.sequenceExpression([
                            t.assignmentExpression("=", clone(done), t.booleanLiteral(true)),
                            t.callExpression(this.addHelper("rhinoForOfClose"), [clone(it)]),
                        ]),
                    ));

                    const returnValues = this.returnValues;
                    const rewritten = new WeakSet();
                    // traverse() only visits the body's descendants: `for (x of xs) break;` needs a block.
                    if (!path.get("body").isBlockStatement()) path.get("body").replaceWith(t.blockStatement([node.body]));
                    path.get("body").traverse({
                        Function(inner) {
                            inner.skip();
                        },
                        "BreakStatement|ContinueStatement|ReturnStatement"(jump) {
                            if (rewritten.has(jump.node) || !leavesLoop(jump, path, ownLabels)) return;
                            const jumpNode = jump.node;
                            rewritten.add(jumpNode);

                            const argument = jump.isReturnStatement() ? jumpNode.argument : null;
                            if (argument && !t.isLiteral(argument) &&
                                !(t.isIdentifier(argument) && returnValues.has(argument.name))) {
                                // Evaluate the return value before closing: `{ var _ret = value; close; return _ret; }`
                                const value = scope.generateUidIdentifier("ret");
                                returnValues.add(value.name);
                                jumpNode.argument = clone(value);
                                jump.replaceWith(t.blockStatement([
                                    t.variableDeclaration("var", [t.variableDeclarator(value, argument)]),
                                    close(),
                                    jumpNode,
                                ]));
                            } else {
                                jump.replaceWith(t.blockStatement([close(), jumpNode]));
                            }
                            jump.skip();
                        },
                    });

                    const loop = t.forOfStatement(node.left, clone(it), node.body);
                    // Innermost label first, so the labels keep their order.
                    let labelled = loop;
                    for (let p = path.parentPath; p !== outer.parentPath; p = p.parentPath) {
                        labelled = t.labeledStatement(p.node.label, labelled);
                    }

                    // Arrays are iterated as they are, checked inline (unless the code shadows the global `Array`).
                    const getIterator = (value) => t.callExpression(this.addHelper("rhinoForOf"), [value]);
                    const arrayShadowed = scope.hasBinding("Array", true);
                    const statements = [t.variableDeclaration("var", [
                        t.variableDeclarator(it, arrayShadowed ? getIterator(node.right) : node.right),
                        t.variableDeclarator(done, t.booleanLiteral(false)),
                    ])];
                    if (!arrayShadowed) {
                        // `if (!Array.isArray(_it)) _it = h.rhinoForOf(_it);`
                        statements.push(t.ifStatement(
                            t.unaryExpression("!", t.callExpression(
                                t.memberExpression(t.identifier("Array"), t.identifier("isArray")), [clone(it)])),
                            t.expressionStatement(t.assignmentExpression("=", clone(it), getIterator(clone(it)))),
                        ));
                    }

                    outer.replaceWith(t.blockStatement([
                        ...statements,
                        t.tryStatement(
                            t.blockStatement([
                                labelled,
                                t.expressionStatement(t.assignmentExpression("=", clone(done), t.booleanLiteral(true))),
                            ]),
                            null,
                            t.blockStatement([t.expressionStatement(t.logicalExpression("||", clone(done),
                                t.callExpression(this.addHelper("rhinoForOfAbort"), [clone(it)]),
                            ))]),
                        ),
                    ]));
                },
            },
        },
    };
}

/**
 * Whether the `break`/`continue`/`return` at `jump` leaves the loop `loop` (whose labels are `ownLabels`).
 *
 * @param {import("@babel/core").NodePath} jump
 * @param {import("@babel/core").NodePath} loop
 * @param {Set<string>} ownLabels
 */
function leavesLoop(jump, loop, ownLabels) {
    if (jump.isReturnStatement()) return true;
    const isBreak = jump.isBreakStatement();
    const label = jump.node.label ? jump.node.label.name : null;
    for (let p = jump.parentPath; p !== loop; p = p.parentPath) {
        if (label !== null) {
            if (p.isLabeledStatement() && p.node.label.name === label) return false;
        } else if (p.isLoop() || (isBreak && p.isSwitchStatement())) {
            return false;
        }
    }
    if (label === null || ownLabels.has(label)) return isBreak;
    return true;
}
