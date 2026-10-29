// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/callable.ts — make a class callable without `new`, like Node's `Console` and
// `readline.Interface` (plain functions in Node, so `Console(stdout)` works as well as `new Console(stdout)`).

/**
 * A constructor function for `cls` that also works without `new`. It shares the class's prototype, so `instanceof`
 * holds either way and `instance.constructor` is the returned function; it can be extended (`class X extends it`),
 * which constructs a real `cls` instance with the subclass's prototype.
 */
function callable<C extends abstract new (...args: any[]) => any>(cls: C): C & ((...args: ConstructorParameters<C>) => InstanceType<C>) {
    let wrapper = function (this: unknown) {
        // new.target: this function for `new`, a subclass for `super(…)`, undefined for a plain call.
        return Reflect.construct(cls as unknown as Function, arguments, new.target ?? wrapper);
    } as unknown as C & ((...args: ConstructorParameters<C>) => InstanceType<C>);
    Object.defineProperty(wrapper, 'name', { value: cls.name, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: cls.length, configurable: true });
    // Static members of the class (and of its superclasses) are inherited.
    Object.setPrototypeOf(wrapper, cls);
    wrapper.prototype = cls.prototype;
    Object.defineProperty(cls.prototype, 'constructor', { value: wrapper, writable: true, configurable: true });
    return wrapper;
}

export = callable;
