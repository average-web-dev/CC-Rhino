// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Holes in array patterns of parameters.
//
// Destructured parameters stay native (transform-destructuring only lowers declarations and assignments, and
// transform-parameters is not needed: Rhino has default and rest parameters). But Rhino binds the wrong elements when
// such a pattern has a hole: `(([, b]) => b)([1, 2])` is 1. So every hole in a parameter's array pattern, at any depth,
// becomes a fresh binding nobody uses — `([_hole, b]) => b` takes the same elements — and everything else stays native
// (defaults, `length`, the parameter scope).

/** @param {import("@babel/core")} babel */
export default function parameterHoles({ types: t }) {
    /** Replace the holes of the array patterns in `node` (a parameter or a part of one) with fresh identifiers. */
    function fillHoles(node, scope) {
        if (node === null || node === undefined) return;
        switch (node.type) {
            case "ArrayPattern":
                node.elements = node.elements.map((element) =>
                    element === null ? t.identifier(scope.generateUid("hole")) : element);
                for (const element of node.elements) fillHoles(element, scope);
                break;
            case "ObjectPattern":
                for (const property of node.properties) {
                    fillHoles(property.type === "RestElement" ? property.argument : property.value, scope);
                }
                break;
            case "AssignmentPattern":
                fillHoles(node.left, scope);
                break;
            case "RestElement":
                fillHoles(node.argument, scope);
                break;
            default:
        }
    }

    return {
        name: "rhino-parameter-holes",
        visitor: {
            Function(path) {
                for (const param of path.node.params) fillHoles(param, path.scope);
            },
        },
    };
}
