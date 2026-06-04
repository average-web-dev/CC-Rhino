// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// A basic 3D vector type and some common vector operations — mirrors the CC Lua
// vector API. Useful when working with Minecraft world coordinates (such as
// those from the gps API).
//
// JavaScript has no operator overloading, so the Lua metamethods (+, -, *, /,
// unary -, ==, tostring) are exposed only as the named methods add/sub/mul/div/
// unm/equals/tostring.

class Vector {
    constructor(x, y, z) {
        this.x = Number(x) || 0;
        this.y = Number(y) || 0;
        this.z = Number(z) || 0;
    }

    // Adds two vectors together.
    add(o) {
        return new Vector(this.x + o.x, this.y + o.y, this.z + o.z);
    }

    // Subtracts one vector from another.
    sub(o) {
        return new Vector(this.x - o.x, this.y - o.y, this.z - o.z);
    }

    // Multiplies a vector by a scalar value.
    mul(factor) {
        return new Vector(this.x * factor, this.y * factor, this.z * factor);
    }

    // Divides a vector by a scalar value.
    div(factor) {
        return new Vector(this.x / factor, this.y / factor, this.z / factor);
    }

    // Negate a vector.
    unm() {
        return new Vector(-this.x, -this.y, -this.z);
    }

    // Compute the dot product of two vectors.
    dot(o) {
        return this.x * o.x + this.y * o.y + this.z * o.z;
    }

    // Compute the cross product of two vectors.
    cross(o) {
        return new Vector(
            this.y * o.z - this.z * o.y,
            this.z * o.x - this.x * o.z,
            this.x * o.y - this.y * o.x,
        );
    }

    // Get the length (magnitude) of this vector.
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    // Divide this vector by its length, producing a unit vector with the same
    // direction.
    normalize() {
        return this.mul(1 / this.length());
    }

    // Construct a vector with each dimension rounded to the nearest value.
    // `tolerance` defaults to 1 (e.g. 0.5 rounds to the nearest 0.5).
    round(tolerance) {
        const t = tolerance ?? 1.0;
        return new Vector(
            Math.floor((this.x + t * 0.5) / t) * t,
            Math.floor((this.y + t * 0.5) / t) * t,
            Math.floor((this.z + t * 0.5) / t) * t,
        );
    }

    // Convert this vector into a string, for pretty printing.
    tostring() {
        return `${this.x},${this.y},${this.z}`;
    }

    // JS interop: make String(v) and `${v}` behave like Lua's tostring(v).
    toString() {
        return this.tostring();
    }

    // Check for equality between two vectors.
    equals(other) {
        return this.x === other.x && this.y === other.y && this.z === other.z;
    }
}

// Construct a new Vector with the given coordinates.
function newVector(x, y, z) {
    return new Vector(x, y, z);
}

export default { new: newVector, Vector };
