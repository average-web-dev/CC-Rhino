// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// new.target on Rhino: a syntax error (transform-new-target).

function Callable(this: unknown): string | undefined {
    if (!new.target) return "called";
    return undefined;
}
check("new.target in a call", Callable.call(undefined), "called");
check("new.target with new", typeof new (Callable as unknown as new () => object)(), "object");

class Base {
    created: string;

    constructor() {
        this.created = new.target.name;
    }
}
class Derived extends Base {}
check("new.target in class constructors", [new Base().created, new Derived().created], ["Base", "Derived"]);

export {};
