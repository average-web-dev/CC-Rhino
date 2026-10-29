// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Literals and object syntax (native on Rhino): template literals, tagged templates, computed properties, shorthand
// properties and methods, accessors, super in object literals.

let name = "world";
check("template literal", `hello ${name}, ${1 + 1}`, "hello world, 2");
check("multi-line template", `a
b`, "a\nb");

function tag(strings: TemplateStringsArray, ...values: unknown[]): string {
    return strings.raw.join("|") + ":" + values.join();
}
check("tagged template", tag`x${1}y\n${2}`, "x|y\\n|:1,2");

let key = "dynamic";
let count = 3;
let object = {
    [key + "Key"]: 1,
    count,
    method() {
        return this.count * 2;
    },
    get doubled() {
        return this.count * 2;
    },
    set doubled(value: number) {
        this.count = value / 2;
    },
    [Symbol.toStringTag]: "Custom",
};
object.doubled = 10;
check("computed and shorthand", [object.dynamicKey, object.count, object.method()], [1, 5, 10]);
check("Symbol keys", Object.prototype.toString.call(object), "[object Custom]");

let parent = {
    greet() {
        return "parent";
    },
};
let child = {
    __proto__: parent,
    greet() {
        return "child of " + super.greet();
    },
};
check("super in object literals", child.greet(), "child of parent");

export {};
