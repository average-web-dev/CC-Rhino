// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/validators.ts — argument checks for ROM code (like Node's lib/internal/validators.js). Each one
// throws the matching Node-style error from internal/errors and narrows the value's type for TypeScript:
//
//   validateFunction(callback, 'callback');
//   validateInteger(rows, 'rows', 1);
//
// Not a public module: programs check their own arguments.

import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE } from '/rom/lib/internal/errors';

export function validateString(value: unknown, name: string): asserts value is string {
    if (typeof value !== 'string') throw new ERR_INVALID_ARG_TYPE(name, 'string', value);
}

export function validateBoolean(value: unknown, name: string): asserts value is boolean {
    if (typeof value !== 'boolean') throw new ERR_INVALID_ARG_TYPE(name, 'boolean', value);
}

export function validateFunction(value: unknown, name: string): asserts value is Function {
    if (typeof value !== 'function') throw new ERR_INVALID_ARG_TYPE(name, 'function', value);
}

/** A number, optionally within [min, max] (NaN is out of range when a bound is given). */
export function validateNumber(value: unknown, name: string, min?: number, max?: number): asserts value is number {
    if (typeof value !== 'number') throw new ERR_INVALID_ARG_TYPE(name, 'number', value);
    if ((min !== undefined && value < min) || (max !== undefined && value > max) ||
        ((min !== undefined || max !== undefined) && Number.isNaN(value))) {
        let range = min !== undefined && max !== undefined ? `>= ${min} && <= ${max}`
            : min !== undefined ? `>= ${min}` : `<= ${max}`;
        throw new ERR_OUT_OF_RANGE(name, range, value);
    }
}

/** An integer within [min, max] (the safe integers by default). */
export function validateInteger(
    value: unknown, name: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
    if (typeof value !== 'number') throw new ERR_INVALID_ARG_TYPE(name, 'number', value);
    if (!Number.isInteger(value)) throw new ERR_OUT_OF_RANGE(name, 'an integer', value);
    if (value < min || value > max) throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
}

export interface ValidateObjectOptions {
    allowArray?: boolean;
    allowFunction?: boolean;
    nullable?: boolean;
}

/** An object (not null, not an array, not a function — unless the options allow them). */
export function validateObject(value: unknown, name: string, options: ValidateObjectOptions = {}): asserts value is object {
    let ok = value === null ? options.nullable === true
        : typeof value === 'function' ? options.allowFunction === true
        : typeof value === 'object' && (options.allowArray === true || !Array.isArray(value));
    if (!ok) throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
}

/** An array with at least `minLength` elements. */
export function validateArray(value: unknown, name: string, minLength = 0): asserts value is unknown[] {
    if (!Array.isArray(value)) throw new ERR_INVALID_ARG_TYPE(name, 'Array', value);
    if (value.length < minLength) throw new ERR_INVALID_ARG_VALUE(name, value, `must be longer than ${minLength}`);
}

/** One of the given values (compared with ===). */
export function validateOneOf<T>(value: unknown, name: string, oneOf: readonly T[]): asserts value is T {
    if (!oneOf.includes(value as T)) {
        let allowed = oneOf.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(', ');
        throw new ERR_INVALID_ARG_VALUE(name, value, `must be one of: ${allowed}`);
    }
}
