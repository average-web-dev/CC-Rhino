// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The geometry module: immutable points (places) and vectors (displacements, directions). Run by StdioLibraryTest.

import * as prelude from './prelude';
import util from 'util';
import { Point, Vector } from 'geometry';

const eq = prelude.eq, throws = prelude.throws;

/** A point or vector as "x,y,z", for compact checks. */
function str(v: Point | Vector): string { return v.toString(); }

eq(require('geometry').Vector, Vector);
eq((require('node:geometry') as GeometryModule).Point, Point, 'a ROM core module');

// ── Vector ───────────────────────────────────────────────────────────────────────

const a = new Vector(1, 2, 3);
const b = new Vector(4, -5, 6);
eq(str(a), '1,2,3');
eq(Object.isFrozen(a), true, 'immutable');
eq(Object.keys(a).sort().join(), 'x,y,z');
throws(() => new Vector(1, 2, '3' as any), 'ERR_INVALID_ARG_TYPE');

eq(str(a.add(b)), '5,-3,9');
eq(str(a.sub(b)), '-3,7,-3');
eq(str(a.mul(2)), '2,4,6');
eq(str(b.div(2)), '2,-2.5,3');
eq(str(a.negate()), '-1,-2,-3');
eq(a.dot(b), 4 - 10 + 18);
eq(str(a.cross(b)), '27,6,-13');
eq(str(a), '1,2,3', 'unchanged');
eq(new Vector(3, 4, 0).length(), 5);
eq(a.lengthSquared(), 14);
eq(b.manhattanLength(), 15);

// Directions follow Minecraft (right-handed: east × up = south).
eq(str(Vector.UP), '0,1,0');
eq(str(Vector.NORTH), '0,0,-1');
eq(str(Vector.EAST), '1,0,0');
eq(str(Vector.EAST.cross(Vector.UP)), '0,0,1', 'east × up is south');
eq(Object.isFrozen(Vector), true, 'the constants cannot be replaced');

eq(str(new Vector(0, 3, 4).normalize()), '0,0.6,0.8');
eq(Vector.ZERO.normalize(), Vector.ZERO, 'the zero vector normalizes to ZERO');
eq(str(new Vector(1.4, 1.5, -1.5).round()), '1,2,-1');
eq(str(new Vector(1.26, 0.74, 3).round(0.5)), '1.5,0.5,3');
throws(() => a.round(0), 'ERR_OUT_OF_RANGE');

throws(() => a.add({ x: 1, y: 1, z: 1 } as any), 'ERR_INVALID_ARG_TYPE', 'only Vectors: convert with Vector.from');
eq(str(a.add(Vector.from({ x: 1, y: 1, z: 1 }))), '2,3,4');
eq(str(Vector.from({ x: 7, y: 8, z: 9 })), '7,8,9');
throws(() => Vector.from({ x: 1, y: 1 } as any), 'ERR_INVALID_ARG_TYPE');
eq(str(Vector.from([7, 8, 9])), '7,8,9');
eq(Vector.from(a), a, 'a Vector is returned as it is');
throws(() => Vector.from([1, 2] as any), 'ERR_INVALID_ARG_TYPE');

eq(a.equals(new Vector(1, 2, 3)), true);
eq(a.equals(b), false);
eq(a.equals(new Vector(1, 2, 3.0001)), false);
eq(a.equals(new Vector(1, 2, 3.0001), 0.001), true);
eq(Vector.equals(a, new Vector(1, 2, 3)), true);

eq(JSON.stringify({ v: a }), '{"v":{"x":1,"y":2,"z":3}}');
eq(`${a}`, '1,2,3');
eq(util.inspect(a), 'Vector(1, 2, 3)');
eq(a.toArray().join(), '1,2,3');

// ── Point ────────────────────────────────────────────────────────────────────────

const home = new Point(10, 64, -3);
eq(Object.isFrozen(home), true, 'immutable');
eq(str(Point.ORIGIN), '0,0,0');

// A point plus a vector is a point; the difference of two points is a vector.
const next = home.add(Vector.NORTH.mul(2));
eq(next instanceof Point, true);
eq(str(next), '10,64,-5');
eq(str(next.sub(Vector.NORTH)), '10,64,-4');
eq(str(home.relative(Vector.EAST)), '11,64,-3');
eq(str(home.relative(Vector.UP, 3)), '10,67,-3');
const way = home.vectorTo(new Point(13, 68, -3));
eq(way instanceof Vector, true);
eq(str(way), '3,4,0');
eq(home.add(way).equals(new Point(13, 68, -3)), true, 'home + (home → p) = p');
eq(str(Vector.between(home, new Point(13, 68, -3))), '3,4,0', 'the vector between two points');
eq(home.distance(new Point(13, 68, -3)), 5);
eq(home.distanceSquared(new Point(13, 68, -3)), 25);
eq(home.manhattan(new Point(13, 68, -3)), 7, 'single steps along the axes');
eq(str(new Point(1.9, -0.1, 3).floor()), '1,-1,3', 'the block a position is in');
eq(str(new Point(1.4, 1.5, -1.5).round()), '1,2,-1');

eq(str(Point.from({ x: 1, y: 2, z: 3 })), '1,2,3', 'a position a native API returned');
eq(str(Point.from([1, 2, 3])), '1,2,3');
eq(Point.from(home), home);
eq(home.equals(new Point(10, 64, -3)), true);
eq(Point.equals(home, next), false);

// Only what makes sense: points are not added, a point is no vector — TypeScript rejects it, and so does the run time.
// @ts-expect-error: a point plus a point
throws(() => home.add(next), 'ERR_INVALID_ARG_TYPE');
// @ts-expect-error: a vector is no place
throws(() => home.vectorTo(way), 'ERR_INVALID_ARG_TYPE');
// @ts-expect-error: a point is no direction
throws(() => a.add(home), 'ERR_INVALID_ARG_TYPE');
// @ts-expect-error: the distance between points, not vectors
throws(() => Vector.between(a, b), 'ERR_INVALID_ARG_TYPE');

eq(JSON.stringify(home), '{"x":10,"y":64,"z":-3}');
eq(util.inspect(home), 'Point(10, 64, -3)');
