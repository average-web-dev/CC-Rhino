// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/internal/errors.ts — the ROM's Node-style errors (like Node's lib/internal/errors.js): each class is a
// TypeError / RangeError / Error with a `code` and Node's message text, so callers can test `err.code` as in Node.
//
//   throw new ERR_INVALID_ARG_TYPE('callback', 'function', callback);
//   // TypeError: The "callback" argument must be of type function. Received type number (5)
//
// Not a public module: programs check their own arguments.

import { inspect } from '/rom/lib/util';

/** The `typeof` names; other expected names are classes ("Array") or descriptions ("a TTY"). */
const TYPE_NAMES = ['string', 'function', 'number', 'object', 'boolean', 'bigint', 'symbol'];
const CLASS_NAME = /^([A-Z][a-z0-9]*)+$/;

/** "a", "a or b", "a, b, or c". */
function formatList(list: string[], word: string): string {
    if (list.length <= 2) return list.join(` ${word} `);
    return `${list.slice(0, -1).join(', ')}, ${word} ${list[list.length - 1]}`;
}

/** `"name" argument`, or `"options.x" property` for a name with a dot. */
function describeName(name: string, quote = '"'): string {
    return name.includes('.') ? `${quote}${name}${quote} property` : `${quote}${name}${quote} argument`;
}

/** What a value is, as Node's error messages say it: `type number (5)`, `an instance of Map`, `null`, … */
function describeValue(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    switch (typeof value) {
        case 'bigint': return `type bigint (${String(value)}n)`;
        case 'number': return `type number (${Object.is(value, -0) ? '-0' : String(value)})`;
        case 'boolean': return `type boolean (${String(value)})`;
        case 'symbol': return `type symbol (${String(value)})`;
        case 'function': return `function ${value.name}`;
        case 'object': {
            let ctor = (value as { constructor?: { name?: unknown } }).constructor;
            if (ctor !== undefined && typeof ctor.name === 'string' && ctor.name !== '') {
                return `an instance of ${ctor.name}`;
            }
            return inspect(value, { depth: -1 });
        }
        default: {
            let str = String(value);
            if (str.length > 28) str = `${str.slice(0, 25)}...`;
            return str.includes("'") ? `type string (${JSON.stringify(str)})` : `type string ('${str}')`;
        }
    }
}

/** A value for "Received …", cut off at 128 characters. */
function inspectShort(value: unknown): string {
    let str = inspect(value);
    return str.length > 128 ? `${str.slice(0, 128)}...` : str;
}

/** 1_000_000_000 style, as Node prints large integers in range errors. */
function addNumericalSeparator(value: string): string {
    let res = '';
    let i = value.length;
    let start = value.charAt(0) === '-' ? 1 : 0;
    for (; i >= start + 4; i -= 3) res = `_${value.slice(i - 3, i)}${res}`;
    return `${value.slice(0, i)}${res}`;
}

/** An argument of the wrong type: `expected` are `typeof` names, class names or descriptions. */
export class ERR_INVALID_ARG_TYPE extends TypeError {
    readonly code = 'ERR_INVALID_ARG_TYPE';

    constructor(name: string, expected: string | string[], actual: unknown) {
        let types: string[] = [];
        let instances: string[] = [];
        let other: string[] = [];
        for (let entry of Array.isArray(expected) ? expected : [expected]) {
            if (TYPE_NAMES.includes(entry)) types.push(entry);
            else if (CLASS_NAME.test(entry)) instances.push(entry);
            else other.push(entry);
        }
        // 'object' goes last, as in Node ("of type string or object").
        let objectIndex = types.indexOf('object');
        if (objectIndex !== -1 && objectIndex !== types.length - 1) {
            types.splice(objectIndex, 1);
            types.push('object');
        }
        let parts: string[] = [];
        if (types.length > 0) parts.push(`${types.length > 1 ? 'one of type' : 'of type'} ${formatList(types, 'or')}`);
        if (instances.length > 0) parts.push(`an instance of ${formatList(instances, 'or')}`);
        if (other.length > 0) {
            parts.push(other.length > 1 ? `one of ${formatList(other, 'or')}` : other[0]);
        }
        super(`The ${describeName(name)} must be ${parts.join(' or ')}. Received ${describeValue(actual)}`);
    }
}

/** An argument of the right type with a value that is not allowed (`reason` says why, default "is invalid"). */
export class ERR_INVALID_ARG_VALUE extends TypeError {
    readonly code = 'ERR_INVALID_ARG_VALUE';

    constructor(name: string, value: unknown, reason = 'is invalid') {
        let what = name.includes('.') ? 'property' : 'argument';
        super(`The ${what} '${name}' ${reason}. Received ${inspectShort(value)}`);
    }
}

/** A number outside its range: `range` completes "It must be …" (e.g. `>= 0 && <= 1000`, `an integer`). */
export class ERR_OUT_OF_RANGE extends RangeError {
    readonly code = 'ERR_OUT_OF_RANGE';

    constructor(name: string, range: string, value: unknown) {
        let received = typeof value === 'number' && Number.isInteger(value) && Math.abs(value) > 2 ** 32
            ? addNumericalSeparator(String(value))
            : inspect(value);
        super(`The value of "${name}" is out of range. It must be ${range}. Received ${received}`);
    }
}

/** Required arguments that were not given. */
export class ERR_MISSING_ARGS extends TypeError {
    readonly code = 'ERR_MISSING_ARGS';

    constructor(...names: string[]) {
        let quoted = names.map((name) => `"${name}"`);
        let list = quoted.length === 2 ? quoted.join(' and ') : formatList(quoted, 'and');
        super(`The ${list} argument${names.length > 1 ? 's' : ''} must be specified`);
    }
}

/** A Console was given something that is not a writable stream. */
export class ERR_CONSOLE_WRITABLE_STREAM extends TypeError {
    readonly code = 'ERR_CONSOLE_WRITABLE_STREAM';

    constructor(name: string) {
        super(`Console expects a writable stream instance for ${name}`);
    }
}

/** An object (a readline interface, …) was used after it was closed. */
export class ERR_USE_AFTER_CLOSE extends Error {
    readonly code = 'ERR_USE_AFTER_CLOSE';

    constructor(name: string) {
        super(`${name} was closed`);
    }
}

/** An 'error' event without listeners whose argument is not an Error. */
export class ERR_UNHANDLED_ERROR extends Error {
    readonly code = 'ERR_UNHANDLED_ERROR';
    readonly context: unknown;

    constructor(context: unknown) {
        super(`Unhandled error. (${inspect(context)})`);
        this.context = context;
    }
}

/** An operation that was aborted (Node's AbortError: name 'AbortError', code 'ABORT_ERR'). */
export class AbortError extends Error {
    readonly code = 'ABORT_ERR';

    constructor(message = 'The operation was aborted') {
        super(message);
        this.name = 'AbortError';
    }
}
