// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/geometry.ts — points and vectors in the world (Tier 0, #2): a Point is a place (a block, a turtle's
// position), a Vector a displacement or direction (an arrow: which way and how far).
//
//   import { Point, Vector } from 'geometry';
//   const home = new Point(10, 64, -3);
//   const next = home.add(Vector.NORTH.mul(2));     // a point plus a vector is a point
//   const way = home.vectorTo(next);                 // the vector from one point to another
//   way.length(); home.manhattan(next);              // how far (straight; in single steps along the axes)
//
// Both are immutable (methods return new objects; the components are read-only, the objects frozen). Methods only take
// what makes sense — a point moves by a vector, two points give a vector (Vector.between / vectorTo), points are never
// added — and check it (TypeScript at compile time, instanceof at run time). Point.from and Vector.from turn anything
// with x, y and z (a position a native API returned) or an [x, y, z] array into one. Directions follow Minecraft: y is
// up, north is -z, east +x (a right-handed system: east × up = south).

import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from '/rom/lib/internal/errors';
import { validateNumber } from '/rom/lib/internal/validators';

/** Anything with numeric `x`, `y` and `z` (a Point, a Vector, or a position a native API returned). */
export interface Coordinates {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** An `[x, y, z]` array. */
export type CoordinateArray = readonly [number, number, number];

const inspectCustom: unique symbol = Symbol.for('nodejs.util.inspect.custom') as any;

function isCoordinates(value: unknown): value is Coordinates {
    if (value === null || typeof value !== 'object') return false;
    let v = value as Record<string, unknown>;
    return typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

/** The components of `value` (Coordinates or an [x, y, z] array), for from(). */
function components(value: unknown, kind: 'Point' | 'Vector'): [number, number, number] {
    if (Array.isArray(value)) {
        if (value.length !== 3) throw new ERR_INVALID_ARG_TYPE('value', [kind, 'an [x, y, z] array'], value);
        return [value[0], value[1], value[2]];
    }
    if (!isCoordinates(value)) {
        throw new ERR_INVALID_ARG_TYPE('value', ['an object with numeric x, y and z', 'an [x, y, z] array'], value);
    }
    return [value.x, value.y, value.z];
}

/** `value` if it is a Vector, else ERR_INVALID_ARG_TYPE (a Point is no Vector: use vectorTo / Vector.between). */
function vectorArg(value: unknown, name: string): Vector {
    if (!(value instanceof Vector)) throw new ERR_INVALID_ARG_TYPE(name, 'Vector', value);
    return value;
}

/** `value` if it is a Point, else ERR_INVALID_ARG_TYPE (convert positions with Point.from). */
function pointArg(value: unknown, name: string): Point {
    if (!(value instanceof Point)) throw new ERR_INVALID_ARG_TYPE(name, 'Point', value);
    return value;
}

function equalWithin(a: Coordinates, b: Coordinates, epsilon: number): boolean {
    validateNumber(epsilon, 'epsilon', 0);
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.z - b.z) <= epsilon;
}

/** `n` rounded to the nearest multiple of `tolerance`. */
function roundTo(n: number, tolerance: number): number {
    return Math.floor(n / tolerance + 0.5) * tolerance;
}

function validateTolerance(tolerance: number): void {
    validateNumber(tolerance, 'tolerance');
    if (!(tolerance > 0)) throw new ERR_OUT_OF_RANGE('tolerance', '> 0', tolerance);
}

/** A displacement or direction: which way and how far. */
export class Vector implements Coordinates {
    readonly x: number;
    readonly y: number;
    readonly z: number;

    constructor(x: number, y: number, z: number) {
        validateNumber(x, 'x');
        validateNumber(y, 'y');
        validateNumber(z, 'z');
        this.x = x;
        this.y = y;
        this.z = z;
        Object.freeze(this);
    }

    static readonly ZERO = new Vector(0, 0, 0);
    static readonly UP = new Vector(0, 1, 0);
    static readonly DOWN = new Vector(0, -1, 0);
    static readonly NORTH = new Vector(0, 0, -1);
    static readonly SOUTH = new Vector(0, 0, 1);
    static readonly EAST = new Vector(1, 0, 0);
    static readonly WEST = new Vector(-1, 0, 0);

    /** A Vector from anything with x, y and z, or an `[x, y, z]` array (a Vector is returned as it is). */
    static from(value: Coordinates | CoordinateArray): Vector {
        if (value instanceof Vector) return value;
        let [x, y, z] = components(value, 'Vector');
        return new Vector(x, y, z);
    }

    /** The vector from point `a` to point `b` (`b - a`): `a.add(Vector.between(a, b))` is `b`. */
    static between(a: Point, b: Point): Vector {
        let from = pointArg(a, 'a');
        let to = pointArg(b, 'b');
        return new Vector(to.x - from.x, to.y - from.y, to.z - from.z);
    }

    /** Whether `a` and `b` have the same components (each within `epsilon`, default exactly). */
    static equals(a: Vector, b: Vector, epsilon = 0): boolean {
        return equalWithin(vectorArg(a, 'a'), vectorArg(b, 'b'), epsilon);
    }

    add(other: Vector): Vector {
        let o = vectorArg(other, 'other');
        return new Vector(this.x + o.x, this.y + o.y, this.z + o.z);
    }

    sub(other: Vector): Vector {
        let o = vectorArg(other, 'other');
        return new Vector(this.x - o.x, this.y - o.y, this.z - o.z);
    }

    /** Scaled by `factor`. */
    mul(factor: number): Vector {
        validateNumber(factor, 'factor');
        return new Vector(this.x * factor, this.y * factor, this.z * factor);
    }

    /** Divided by `divisor`. */
    div(divisor: number): Vector {
        validateNumber(divisor, 'divisor');
        return new Vector(this.x / divisor, this.y / divisor, this.z / divisor);
    }

    /** The opposite direction. */
    negate(): Vector {
        return new Vector(-this.x, -this.y, -this.z);
    }

    dot(other: Vector): number {
        let o = vectorArg(other, 'other');
        return this.x * o.x + this.y * o.y + this.z * o.z;
    }

    cross(other: Vector): Vector {
        let o = vectorArg(other, 'other');
        return new Vector(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x);
    }

    length(): number {
        return Math.sqrt(this.lengthSquared());
    }

    lengthSquared(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    /** The length in single steps along the axes (`|x| + |y| + |z|`), as a turtle moves. */
    manhattanLength(): number {
        return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
    }

    /** The same direction with length 1; the zero vector stays Vector.ZERO. */
    normalize(): Vector {
        let length = this.length();
        return length === 0 ? Vector.ZERO : this.div(length);
    }

    /** Each component rounded to the nearest multiple of `tolerance` (default 1: whole numbers). */
    round(tolerance = 1): Vector {
        validateTolerance(tolerance);
        return new Vector(roundTo(this.x, tolerance), roundTo(this.y, tolerance), roundTo(this.z, tolerance));
    }

    /** Whether `other` has the same components (each within `epsilon`, default exactly). */
    equals(other: Vector, epsilon = 0): boolean {
        return equalWithin(this, vectorArg(other, 'other'), epsilon);
    }

    toArray(): [number, number, number] {
        return [this.x, this.y, this.z];
    }

    /** `{ x, y, z }`. */
    toJSON(): { x: number; y: number; z: number } {
        return { x: this.x, y: this.y, z: this.z };
    }

    /** `"x,y,z"`. */
    toString(): string {
        return `${this.x},${this.y},${this.z}`;
    }

    /** util.inspect / console.log: `Vector(1, 2, 3)`. */
    [inspectCustom](): string {
        return `Vector(${this.x}, ${this.y}, ${this.z})`;
    }
}

/** A place in the world. */
export class Point implements Coordinates {
    readonly x: number;
    readonly y: number;
    readonly z: number;

    constructor(x: number, y: number, z: number) {
        validateNumber(x, 'x');
        validateNumber(y, 'y');
        validateNumber(z, 'z');
        this.x = x;
        this.y = y;
        this.z = z;
        Object.freeze(this);
    }

    /** (0, 0, 0). */
    static readonly ORIGIN = new Point(0, 0, 0);

    /** A Point from anything with x, y and z, or an `[x, y, z]` array (a Point is returned as it is). */
    static from(value: Coordinates | CoordinateArray): Point {
        if (value instanceof Point) return value;
        let [x, y, z] = components(value, 'Point');
        return new Point(x, y, z);
    }

    /** Whether `a` and `b` are the same place (each component within `epsilon`, default exactly). */
    static equals(a: Point, b: Point, epsilon = 0): boolean {
        return equalWithin(pointArg(a, 'a'), pointArg(b, 'b'), epsilon);
    }

    /** This point moved by `vector`. */
    add(vector: Vector): Point {
        let v = vectorArg(vector, 'vector');
        return new Point(this.x + v.x, this.y + v.y, this.z + v.z);
    }

    /** This point moved back by `vector`. */
    sub(vector: Vector): Point {
        let v = vectorArg(vector, 'vector');
        return new Point(this.x - v.x, this.y - v.y, this.z - v.z);
    }

    /** The point `steps` (default 1) steps in `direction`: `add(direction.mul(steps))`. */
    relative(direction: Vector, steps = 1): Point {
        let d = vectorArg(direction, 'direction');
        validateNumber(steps, 'steps');
        return new Point(this.x + d.x * steps, this.y + d.y * steps, this.z + d.z * steps);
    }

    /** The vector from this point to `other` (Vector.between(this, other)). */
    vectorTo(other: Point): Vector {
        return Vector.between(this, other);
    }

    distance(other: Point): number {
        return Math.sqrt(this.distanceSquared(other));
    }

    distanceSquared(other: Point): number {
        return this.vectorTo(other).lengthSquared();
    }

    /** The Manhattan (block) distance: how many single steps along the axes lead to `other`. */
    manhattan(other: Point): number {
        return this.vectorTo(other).manhattanLength();
    }

    /** Each component rounded down: the block this point is in. */
    floor(): Point {
        return new Point(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    }

    /** Each component rounded to the nearest multiple of `tolerance` (default 1: whole numbers). */
    round(tolerance = 1): Point {
        validateTolerance(tolerance);
        return new Point(roundTo(this.x, tolerance), roundTo(this.y, tolerance), roundTo(this.z, tolerance));
    }

    /** Whether `other` is the same place (each component within `epsilon`, default exactly). */
    equals(other: Point, epsilon = 0): boolean {
        return equalWithin(this, pointArg(other, 'other'), epsilon);
    }

    toArray(): [number, number, number] {
        return [this.x, this.y, this.z];
    }

    /** `{ x, y, z }`. */
    toJSON(): { x: number; y: number; z: number } {
        return { x: this.x, y: this.y, z: this.z };
    }

    /** `"x,y,z"`. */
    toString(): string {
        return `${this.x},${this.y},${this.z}`;
    }

    /** util.inspect / console.log: `Point(1, 2, 3)`. */
    [inspectCustom](): string {
        return `Point(${this.x}, ${this.y}, ${this.z})`;
    }
}

Object.freeze(Vector);
Object.freeze(Point);
