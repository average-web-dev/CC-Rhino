// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Classes on Rhino (no native `class` syntax): compiled by tsc (fields, #private, static blocks) and Babel
// (transform-classes), using helpers from the native `babel-helpers` module.

class Animal {
    static count = 0;
    static readonly kind: string = "animal";
    legs = 4;
    #secret = "hidden";
    #calls = 0;

    constructor(public name: string) {
        Animal.count++;
    }

    get description(): string {
        return `${this.name} (${this.legs})`;
    }

    set description(value: string) {
        this.name = value;
    }

    speak(): string {
        this.#calls++;
        return `${this.name} makes a sound`;
    }

    get calls(): number {
        return this.#calls;
    }

    #whisper(): string {
        return this.#secret;
    }

    reveal(): string {
        return this.#whisper();
    }

    static isAnimal(value: unknown): boolean {
        return value instanceof Animal;
    }

    static hasSecret(value: object): boolean {
        return #secret in value;
    }

    *[Symbol.iterator](): Iterator<string> {
        yield this.name;
        yield String(this.legs);
    }

    static registry: string[];

    static {
        Animal.registry = ["static block"];
    }
}

class Dog extends Animal {
    tricks: string[] = [];

    constructor(name: string, ...tricks: string[]) {
        super(name);
        this.tricks.push(...tricks);
    }

    override speak(): string {
        return super.speak() + " (woof)";
    }

    override get description(): string {
        return "dog " + super.description;
    }

    static create(name: string): Dog {
        return new this(name, "sit");
    }
}

// A derived class without its own constructor.
class Puppy extends Dog {
    override speak(): string {
        return "yip";
    }
}

let dog = new Dog("Rex", "sit", "roll");
check("constructor and fields", [dog.name, dog.legs, dog.tricks.join("+")], ["Rex", 4, "sit+roll"]);
check("method", dog.speak(), "Rex makes a sound (woof)");
check("super getter", dog.description, "dog Rex (4)");
let animal = new Animal("Cat");
animal.description = "Max";
dog.name = "Max";
check("setter", animal.name, "Max");
check("#private field and method", [dog.calls, dog.reveal()], [1, "hidden"]);
check("#x in obj", [Animal.hasSecret(dog), Animal.hasSecret({})], [true, false]);
check("static members and blocks", [Animal.count, Animal.kind, Animal.registry[0]], [2, "animal", "static block"]);
check("static inheritance", Dog.isAnimal(Dog.create("Fido")), true);
check("instanceof", [dog instanceof Dog, dog instanceof Animal, new Puppy("p") instanceof Dog], [true, true, true]);
check("implicit derived constructor", [new Puppy("Bo", "beg").tricks.join(), new Puppy("Bo").speak()], ["beg", "yip"]);
check("generator method", Array.from(dog).join(), "Max,4");
check("class name", [Dog.name, dog.constructor === Dog], ["Dog", true]);
check("methods are not enumerable", Object.keys(Dog.prototype).length, 0);

let threw = "";
try {
    (Dog as unknown as () => void)();
} catch (e) {
    threw = (e as Error).constructor.name;
}
check("calling a class without new throws", threw, "TypeError");

// Subclasses of native constructors.
class HttpError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = "HttpError";
    }
}

let error = new HttpError("not found", 404);
check("extends Error", [error instanceof HttpError, error instanceof Error, error.message, error.status], [true, true, "not found", 404]);
check("Error subclass stack", typeof error.stack, "string");
check("Error subclass toString", String(error), "HttpError: not found");
let caught: unknown;
try {
    throw new HttpError("boom", 500);
} catch (e) {
    caught = e;
}
check("thrown Error subclass", caught instanceof HttpError && (caught as HttpError).status, 500);

class Registry extends Map<string, number> {
    total(): number {
        let sum = 0;
        for (const value of this.values()) sum += value;
        return sum;
    }
}

let registry = new Registry([["a", 1], ["b", 2]]);
check("extends Map", [registry instanceof Map, registry.size, registry.total()], [true, 2, 3]);

// Class expressions and classes capturing loop variables.
let makers: (() => string)[] = [];
for (const label of ["x", "y"]) {
    const Local = class {
        get label() {
            return label;
        }
    };
    makers.push(() => new Local().label);
}
check("class expressions in loops", makers.map((f) => f()).join(), "x,y");

export {};
