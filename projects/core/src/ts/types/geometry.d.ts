// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `geometry` — points and vectors in the world (ROM module /rom/lib/geometry): a Point is a place, a Vector a displacement
// or direction. Both are immutable. Methods only take what makes sense (a point moves by a vector, two points give a
// vector, points are never added); Point.from / Vector.from convert anything with x, y and z. Directions follow
// Minecraft: y is up, north is -z, east +x.

/** Anything with numeric `x`, `y` and `z` (what Point.from / Vector.from take, e.g. a position a native API returned). */
interface Coordinates {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** A displacement or direction: which way and how far. */
interface Vector extends Coordinates {
    add(other: Vector): Vector;
    sub(other: Vector): Vector;
    /** Scaled by `factor`. */
    mul(factor: number): Vector;
    /** Divided by `divisor`. */
    div(divisor: number): Vector;
    /** The opposite direction. */
    negate(): Vector;
    dot(other: Vector): number;
    cross(other: Vector): Vector;
    length(): number;
    lengthSquared(): number;
    /** The length in single steps along the axes (`|x| + |y| + |z|`), as a turtle moves. */
    manhattanLength(): number;
    /** The same direction with length 1; the zero vector stays Vector.ZERO. */
    normalize(): Vector;
    /** Each component rounded to the nearest multiple of `tolerance` (default 1: whole numbers). */
    round(tolerance?: number): Vector;
    /** Whether `other` has the same components (each within `epsilon`, default exactly). */
    equals(other: Vector, epsilon?: number): boolean;
    toArray(): [number, number, number];
    /** `{ x, y, z }`. */
    toJSON(): { x: number; y: number; z: number };
    /** `"x,y,z"`. */
    toString(): string;
}

interface VectorConstructor {
    new (x: number, y: number, z: number): Vector;
    readonly prototype: Vector;
    readonly ZERO: Vector;
    readonly UP: Vector;
    readonly DOWN: Vector;
    readonly NORTH: Vector;
    readonly SOUTH: Vector;
    readonly EAST: Vector;
    readonly WEST: Vector;
    /** A Vector from anything with x, y and z, or an `[x, y, z]` array (a Vector is returned as it is). */
    from(value: Coordinates | readonly [number, number, number]): Vector;
    /** The vector from point `a` to point `b`: `a.add(Vector.between(a, b))` is `b`. */
    between(a: Point, b: Point): Vector;
    /** Whether `a` and `b` have the same components (each within `epsilon`, default exactly). */
    equals(a: Vector, b: Vector, epsilon?: number): boolean;
}

/** A place in the world. */
interface Point extends Coordinates {
    /** This point moved by `vector`. */
    add(vector: Vector): Point;
    /** This point moved back by `vector`. */
    sub(vector: Vector): Point;
    /** The point `steps` (default 1) steps in `direction`. */
    relative(direction: Vector, steps?: number): Point;
    /** The vector from this point to `other` (Vector.between(this, other)). */
    vectorTo(other: Point): Vector;
    distance(other: Point): number;
    distanceSquared(other: Point): number;
    /** The Manhattan (block) distance: how many single steps along the axes lead to `other`. */
    manhattan(other: Point): number;
    /** Each component rounded down: the block this point is in. */
    floor(): Point;
    /** Each component rounded to the nearest multiple of `tolerance` (default 1: whole numbers). */
    round(tolerance?: number): Point;
    /** Whether `other` is the same place (each component within `epsilon`, default exactly). */
    equals(other: Point, epsilon?: number): boolean;
    toArray(): [number, number, number];
    /** `{ x, y, z }`. */
    toJSON(): { x: number; y: number; z: number };
    /** `"x,y,z"`. */
    toString(): string;
}

interface PointConstructor {
    new (x: number, y: number, z: number): Point;
    readonly prototype: Point;
    /** (0, 0, 0). */
    readonly ORIGIN: Point;
    /** A Point from anything with x, y and z, or an `[x, y, z]` array (a Point is returned as it is). */
    from(value: Coordinates | readonly [number, number, number]): Point;
    /** Whether `a` and `b` are the same place (each component within `epsilon`, default exactly). */
    equals(a: Point, b: Point, epsilon?: number): boolean;
}

interface GeometryModule {
    Point: PointConstructor;
    Vector: VectorConstructor;
}

declare function require(id: "geometry"): GeometryModule;
declare module "geometry" { const geometry: GeometryModule; export = geometry; }
