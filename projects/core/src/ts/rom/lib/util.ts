// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/util.ts — a port of the parts of Node's `util` that console and readline need, and that are cheap and
// meaningful on a computer: format / formatWithOptions, inspect (lib/internal/util/inspect.js: depth, circular
// references, compact grouping, breakLength), inherits, promisify, stripVTControlCharacters and styleText.
//
// Differences from Node: no colours in inspect (`colors` is accepted and ignored — the terminal does understand the
// ANSI colours styleText produces), no Proxy detection, and promise states cannot be inspected on Rhino.

const customInspect: unique symbol = Symbol.for('nodejs.util.inspect.custom') as any;
const customPromisify: unique symbol = Symbol.for('nodejs.util.promisify.custom') as any;

const defaultOptions = {
    showHidden: false,
    depth: 2,
    colors: false,
    customInspect: true,
    showProxy: false,
    maxArrayLength: 100,
    maxStringLength: 10000,
    breakLength: 80,
    compact: 3 as number | boolean,
    sorted: false as boolean | ((a: string, b: string) => number),
    getters: false,
};

interface Context {
    showHidden: boolean;
    depth: number;
    customInspect: boolean;
    maxArrayLength: number;
    maxStringLength: number;
    breakLength: number;
    compact: number | boolean;
    sorted: boolean | ((a: string, b: string) => number);
    getters: boolean;
    seen: unknown[];
    circular: Map<unknown, number> | undefined;
    indentationLvl: number;
    currentDepth: number;
    userOptions: InspectOptions;
}

const kObjectType = 0;
const kArrayExtrasType = 2;

const keyStrRegExp = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const indexRegExp = /^(0|[1-9][0-9]*)$/;

const builtInObjects: Record<string, true> = {};
for (let name of ['Object', 'Function', 'Array', 'Number', 'Boolean', 'String', 'Symbol', 'Date', 'Promise', 'RegExp',
    'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'AggregateError',
    'ArrayBuffer', 'DataView', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
    'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
    'BigUint64Array', 'BigInt', 'Proxy', 'Reflect', 'JSON', 'Math']) {
    builtInObjects[name] = true;
}

// ── Strings ──────────────────────────────────────────────────────────────────────

const META: Record<string, string> = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '\\': '\\\\' };

function hex2(code: number): string {
    let h = code.toString(16).toUpperCase();
    return h.length < 2 ? '0' + h : h;
}

/** Quote and escape a string the way Node does: single quotes unless the string contains them. */
function strEscape(str: string): string {
    let quote = "'";
    if (str.indexOf("'") !== -1) {
        if (str.indexOf('"') === -1) quote = '"';
        else if (str.indexOf('`') === -1 && str.indexOf('${') === -1) quote = '`';
    }
    let result = '';
    for (let i = 0; i < str.length; i++) {
        let ch = str.charAt(i);
        let code = str.charCodeAt(i);
        if (ch === quote) result += '\\' + ch;
        else if (META[ch] !== undefined) result += META[ch];
        else if (code < 0x20 || code === 0x7f) result += '\\x' + hex2(code);
        else result += ch;
    }
    return quote + result + quote;
}

const ansiPattern = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[@-Z\\-_]/g;

function stripVTControlCharacters(str: string): string {
    if (typeof str !== 'string') throw invalidArgType('str', 'string', str);
    return str.replace(ansiPattern, '');
}

// ── inspect ──────────────────────────────────────────────────────────────────────

function invalidArgType(name: string, expected: string, actual: unknown): TypeError {
    let err = new TypeError(`The "${name}" argument must be of type ${expected}. Received ${inspect(actual)}`);
    (err as any).code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

function formatNumber(n: number): string {
    return Object.is(n, -0) ? '-0' : String(n);
}

function formatPrimitive(ctx: Context, value: unknown): string {
    switch (typeof value) {
        case 'string': {
            let trailer = '';
            let str = value as string;
            if (str.length > ctx.maxStringLength) {
                let remaining = str.length - ctx.maxStringLength;
                str = str.slice(0, ctx.maxStringLength);
                trailer = `... ${remaining} more character${remaining > 1 ? 's' : ''}`;
            }
            return strEscape(str) + trailer;
        }
        case 'number': return formatNumber(value as number);
        case 'bigint': return `${String(value)}n`;
        case 'boolean': return String(value);
        case 'undefined': return 'undefined';
        default: return String(value); // symbol
    }
}

/** Name of the constructor whose prototype `obj` inherits from, or null for a null prototype. */
function getConstructorName(obj: object): string | null {
    let o: any = obj;
    let first = true;
    while (o !== null && o !== undefined) {
        let descriptor = Object.getOwnPropertyDescriptor(o, 'constructor');
        if (descriptor !== undefined && typeof descriptor.value === 'function' &&
            typeof descriptor.value.name === 'string' && descriptor.value.name !== '') {
            return descriptor.value.name;
        }
        o = Object.getPrototypeOf(o);
        if (first && o === null) return null;
        first = false;
    }
    return 'Object';
}

function getPrefix(ctorName: string | null, fallback: string, size = ''): string {
    if (ctorName === null) return `[${fallback}${size}: null prototype] `;
    return `${ctorName}${size} `;
}

function isError(value: unknown): value is Error {
    return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

function isTypedArray(value: unknown): value is ArrayLike<number> {
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function getKeys(value: object, showHidden: boolean): (string | symbol)[] {
    let keys: (string | symbol)[];
    let symbols = Object.getOwnPropertySymbols(value);
    if (showHidden) {
        keys = (Object.getOwnPropertyNames(value) as (string | symbol)[]).concat(symbols);
    } else {
        keys = Object.keys(value);
        for (let symbol of symbols) {
            if (Object.prototype.propertyIsEnumerable.call(value, symbol)) keys.push(symbol);
        }
    }
    return keys;
}

function nonIndexKeys(keys: (string | symbol)[]): (string | symbol)[] {
    let out: (string | symbol)[] = [];
    for (let key of keys) {
        if (typeof key === 'string' && indexRegExp.test(key)) continue;
        out.push(key);
    }
    return out;
}

function getFunctionBase(value: Function, ctorName: string | null): string {
    let tag = Object.prototype.toString.call(value);
    let type = 'Function';
    if (tag.indexOf('GeneratorFunction') !== -1) type = 'GeneratorFunction';
    else if (tag.indexOf('AsyncFunction') !== -1) type = 'AsyncFunction';
    let base = `[${type}`;
    if (ctorName === null) base += ' (null prototype)';
    let name = (value as any).name;
    if (typeof name !== 'string' || name === '') base += ' (anonymous)';
    else base += `: ${name}`;
    base += ']';
    if (ctorName !== null && ctorName !== type && ctorName !== 'Function' &&
        ctorName.indexOf('GeneratorFunction') === -1) {
        base += ` ${ctorName}`;
    }
    return base;
}

/** An error as Node shows it: "Name: message" followed by the stack frames (indented like V8's). */
function formatError(err: Error, ctx: Context): string {
    let header: string;
    try {
        header = Error.prototype.toString.call(err);
    } catch {
        header = '[Error]';
    }
    let stack = typeof err.stack === 'string' ? err.stack : '';
    let lines: string[] = [];
    for (let line of stack.split('\n')) {
        let trimmed = line.trim();
        if (trimmed !== '') lines.push('    ' + trimmed);
    }
    if (lines.length === 0) return `[${header}]`;
    let result = header + '\n' + lines.join('\n');
    if (ctx.indentationLvl !== 0) {
        let indentation = ' '.repeat(ctx.indentationLvl);
        result = result.split('\n').join(`\n${indentation}`);
    }
    return result;
}

function formatValue(ctx: Context, value: unknown, recurseTimes: number): string {
    if (typeof value !== 'object' && typeof value !== 'function') return formatPrimitive(ctx, value);
    if (value === null) return 'null';

    if (ctx.customInspect) {
        let maybeCustom: unknown;
        try { maybeCustom = (value as any)[customInspect]; } catch { maybeCustom = undefined; }
        if (typeof maybeCustom === 'function' && maybeCustom !== inspect) {
            let depth = ctx.depth === Infinity ? Infinity : ctx.depth - recurseTimes;
            let options: InspectOptions = {};
            let user = ctx.userOptions as Record<string, unknown>;
            for (let key of Object.keys(user)) (options as Record<string, unknown>)[key] = user[key];
            options.depth = depth;
            let ret = (maybeCustom as Function).call(value, depth, options, inspect);
            if (ret !== value) {
                if (typeof ret !== 'string') return formatValue(ctx, ret, recurseTimes);
                return ret.split('\n').join(`\n${' '.repeat(ctx.indentationLvl)}`);
            }
        }
    }

    if (ctx.seen.indexOf(value) !== -1) {
        let index = 1;
        if (ctx.circular === undefined) {
            ctx.circular = new Map();
            ctx.circular.set(value, index);
        } else {
            let existing = ctx.circular.get(value);
            if (existing === undefined) {
                index = ctx.circular.size + 1;
                ctx.circular.set(value, index);
            } else {
                index = existing;
            }
        }
        return `[Circular *${index}]`;
    }

    return formatRaw(ctx, value as object, recurseTimes);
}

type Formatter = (ctx: Context, value: any, recurseTimes: number) => string[];

function formatRaw(ctx: Context, value: object, recurseTimes: number): string {
    let ctorName = getConstructorName(value);
    let keys = getKeys(value, ctx.showHidden);
    let base = '';
    let braces: [string, string] = ['{', '}'];
    let formatter: Formatter = () => [];
    let extrasType = kObjectType;

    if (Array.isArray(value)) {
        let prefix = ctorName !== 'Array' ? getPrefix(ctorName, 'Array', `(${value.length})`) : '';
        keys = nonIndexKeys(keys);
        braces = [`${prefix}[`, ']'];
        if (value.length === 0 && keys.length === 0) return `${braces[0]}]`;
        extrasType = kArrayExtrasType;
        formatter = formatArray;
    } else if (value instanceof Set) {
        let prefix = getPrefix(ctorName, 'Set', `(${value.size})`);
        formatter = formatSet;
        if (value.size === 0 && keys.length === 0) return `${prefix}{}`;
        braces = [`${prefix}{`, '}'];
    } else if (value instanceof Map) {
        let prefix = getPrefix(ctorName, 'Map', `(${value.size})`);
        formatter = formatMap;
        if (value.size === 0 && keys.length === 0) return `${prefix}{}`;
        braces = [`${prefix}{`, '}'];
    } else if (isTypedArray(value)) {
        keys = nonIndexKeys(keys);
        let prefix = getPrefix(ctorName, 'TypedArray', `(${value.length})`);
        braces = [`${prefix}[`, ']'];
        if (value.length === 0 && keys.length === 0) return `${braces[0]}]`;
        formatter = formatTypedArray;
        extrasType = kArrayExtrasType;
    } else if (typeof value === 'function') {
        base = getFunctionBase(value, ctorName);
        if (keys.length === 0) return base;
    } else if (value instanceof RegExp) {
        base = RegExp.prototype.toString.call(value);
        if (ctorName !== 'RegExp') base = getPrefix(ctorName, 'RegExp') + base;
        if (keys.length === 0) return base;
    } else if (value instanceof Date) {
        base = isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
        if (ctorName !== 'Date') base = getPrefix(ctorName, 'Date') + base;
        if (keys.length === 0) return base;
    } else if (isError(value)) {
        base = formatError(value, ctx);
        if (keys.length === 0) return base;
    } else if (value instanceof Number || value instanceof String || value instanceof Boolean) {
        let type = value instanceof Number ? 'Number' : value instanceof String ? 'String' : 'Boolean';
        let primitive = formatPrimitive(ctx, value.valueOf());
        base = `[${type}: ${primitive}]`;
        if (value instanceof String) keys = nonIndexKeys(keys);
        if (keys.length === 0) return base;
    } else if (value instanceof Promise) {
        // Rhino gives no access to a promise's state.
        braces = [`${getPrefix(ctorName, 'Promise')}{`, '}'];
        formatter = () => ['<unknown>'];
    } else if (value instanceof WeakSet || value instanceof WeakMap) {
        return `${getPrefix(ctorName, value instanceof WeakSet ? 'WeakSet' : 'WeakMap')}{ <items unknown> }`;
    } else {
        if (ctorName === 'Object') {
            if (keys.length === 0) return '{}';
        } else {
            braces[0] = `${getPrefix(ctorName, 'Object')}{`;
            if (keys.length === 0) return `${braces[0]}}`;
        }
    }

    if (recurseTimes > ctx.depth) {
        let name = getPrefix(ctorName, 'Object').slice(0, -1);
        return ctorName !== null ? `[${name}]` : name;
    }

    recurseTimes += 1;
    ctx.seen.push(value);
    ctx.currentDepth = recurseTimes;
    let output: string[];
    try {
        output = formatter(ctx, value, recurseTimes);
        for (let key of keys) output.push(formatProperty(ctx, value, recurseTimes, key, extrasType));
    } finally {
        ctx.seen.pop();
    }

    if (ctx.circular !== undefined) {
        let index = ctx.circular.get(value);
        if (index !== undefined) {
            let reference = `<ref *${index}>`;
            base = base === '' ? reference : `${reference} ${base}`;
        }
    }

    if (ctx.sorted) {
        let comparator = ctx.sorted === true ? undefined : ctx.sorted;
        if (extrasType === kObjectType) output = output.sort(comparator);
    }

    return reduceToSingleString(ctx, output, base, braces, extrasType, recurseTimes, value);
}

function formatProperty(ctx: Context, value: any, recurseTimes: number, key: string | symbol | number, type: number): string {
    let str: string;
    let extra = ' ';
    let descriptor: PropertyDescriptor | undefined;
    try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
        descriptor = undefined;
    }
    if (descriptor === undefined) descriptor = { value: value[key], enumerable: true };

    if (descriptor.value !== undefined) {
        let diff = ctx.compact !== true || type !== kObjectType ? 2 : 3;
        ctx.indentationLvl += diff;
        str = formatValue(ctx, descriptor.value, recurseTimes);
        if (diff === 3 && ctx.breakLength < str.length) extra = `\n${' '.repeat(ctx.indentationLvl)}`;
        ctx.indentationLvl -= diff;
    } else if (descriptor.get !== undefined) {
        let label = descriptor.set !== undefined ? 'Getter/Setter' : 'Getter';
        if (ctx.getters) {
            try {
                let tmp = descriptor.get.call(value);
                ctx.indentationLvl += 2;
                str = tmp === null ? `[${label}: null]` :
                    typeof tmp === 'object' ? `[${label}] ${formatValue(ctx, tmp, recurseTimes)}` :
                        `[${label}: ${formatPrimitive(ctx, tmp)}]`;
                ctx.indentationLvl -= 2;
            } catch (err) {
                str = `[${label}: <Inspection threw (${(err as any)?.message})>]`;
            }
        } else {
            str = `[${label}]`;
        }
    } else if (descriptor.set !== undefined) {
        str = '[Setter]';
    } else {
        str = 'undefined';
    }

    if (type === kArrayExtrasType && typeof key === 'number') return str;

    let name: string;
    if (typeof key === 'symbol') name = `[${String(key)}]`;
    else if (key === '__proto__') name = "['__proto__']";
    else if (descriptor.enumerable === false) name = `[${keyStrRegExp.test(String(key)) ? key : strEscape(String(key))}]`;
    else if (keyStrRegExp.test(String(key))) name = String(key);
    else name = strEscape(String(key));
    return `${name}:${extra}${str}`;
}

function formatArray(ctx: Context, value: unknown[], recurseTimes: number): string[] {
    let valLen = value.length;
    let len = Math.min(Math.max(0, ctx.maxArrayLength), valLen);
    let remaining = valLen - len;
    let output: string[] = [];
    let holes = 0;
    for (let i = 0; i < len; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) { holes++; continue; }
        if (holes > 0) {
            output.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`);
            holes = 0;
        }
        output.push(formatProperty(ctx, value, recurseTimes, i, kArrayExtrasType));
    }
    if (holes > 0) output.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`);
    if (remaining > 0) output.push(`... ${remaining} more item${remaining > 1 ? 's' : ''}`);
    return output;
}

function formatTypedArray(ctx: Context, value: ArrayLike<number>, _recurseTimes: number): string[] {
    let len = Math.min(Math.max(0, ctx.maxArrayLength), value.length);
    let remaining = value.length - len;
    let output: string[] = [];
    for (let i = 0; i < len; i++) output.push(formatPrimitive(ctx, value[i]));
    if (remaining > 0) output.push(`... ${remaining} more item${remaining > 1 ? 's' : ''}`);
    return output;
}

function formatSet(ctx: Context, value: Set<unknown>, recurseTimes: number): string[] {
    let output: string[] = [];
    ctx.indentationLvl += 2;
    let items: unknown[] = [];
    value.forEach((v) => { items.push(v); });
    for (let item of items) output.push(formatValue(ctx, item, recurseTimes));
    ctx.indentationLvl -= 2;
    return output;
}

function formatMap(ctx: Context, value: Map<unknown, unknown>, recurseTimes: number): string[] {
    let output: string[] = [];
    ctx.indentationLvl += 2;
    let entries: [unknown, unknown][] = [];
    value.forEach((v, k) => { entries.push([k, v]); });
    for (let entry of entries) {
        output.push(`${formatValue(ctx, entry[0], recurseTimes)} => ${formatValue(ctx, entry[1], recurseTimes)}`);
    }
    ctx.indentationLvl -= 2;
    return output;
}

/** Arrange long arrays of short entries in columns (Node's groupArrayElements). */
function groupArrayElements(ctx: Context, output: string[], value: unknown): string[] {
    let totalLength = 0;
    let maxLength = 0;
    let outputLength = output.length;
    if (ctx.maxArrayLength < output.length) outputLength--; // the "... more items" entry
    let separatorSpace = 2;
    let dataLen: number[] = [];
    for (let i = 0; i < outputLength; i++) {
        let len = output[i].length;
        dataLen.push(len);
        totalLength += len + separatorSpace;
        if (maxLength < len) maxLength = len;
    }
    let actualMax = maxLength + separatorSpace;
    if (actualMax * 3 + ctx.indentationLvl < ctx.breakLength &&
        (totalLength / actualMax > 5 || maxLength <= 6)) {
        let approxCharHeights = 2.5;
        let averageBias = Math.sqrt(actualMax - totalLength / output.length);
        let biasedMax = Math.max(actualMax - 3 - averageBias, 1);
        let columns = Math.min(
            Math.round(Math.sqrt(approxCharHeights * biasedMax * outputLength) / biasedMax),
            Math.floor((ctx.breakLength - ctx.indentationLvl) / actualMax),
            (ctx.compact as number) * 4,
            15,
        );
        if (columns <= 1) return output;
        let tmp: string[] = [];
        let maxLineLength: number[] = [];
        for (let i = 0; i < columns; i++) {
            let lineLength = 0;
            for (let j = i; j < output.length; j += columns) {
                if (dataLen[j] > lineLength) lineLength = dataLen[j];
            }
            maxLineLength.push(lineLength + separatorSpace);
        }
        let padStart = true;
        if (value !== undefined) {
            for (let i = 0; i < output.length; i++) {
                let item = (value as any)[i];
                if (typeof item !== 'number' && typeof item !== 'bigint') { padStart = false; break; }
            }
        }
        for (let i = 0; i < outputLength; i += columns) {
            let max = Math.min(i + columns, outputLength);
            let str = '';
            let j = i;
            for (; j < max - 1; j++) {
                let cell = `${output[j]}, `;
                let padding = maxLineLength[j - i];
                str += padStart ? cell.padStart(padding, ' ') : cell.padEnd(padding, ' ');
            }
            if (padStart) {
                str += output[j].padStart(maxLineLength[j - i] - separatorSpace, ' ');
            } else {
                str += output[j];
            }
            tmp.push(str);
        }
        if (ctx.maxArrayLength < output.length) tmp.push(output[outputLength]);
        output = tmp;
    }
    return output;
}

function isBelowBreakLength(ctx: Context, output: string[], start: number, base: string): boolean {
    let totalLength = output.length + start;
    if (totalLength + output.length > ctx.breakLength) return false;
    for (let i = 0; i < output.length; i++) {
        totalLength += output[i].length;
        if (totalLength > ctx.breakLength) return false;
    }
    return base === '' || base.indexOf('\n') === -1;
}

function reduceToSingleString(
    ctx: Context, output: string[], base: string, braces: [string, string], extrasType: number,
    recurseTimes: number, value: unknown,
): string {
    if (ctx.compact !== true) {
        if (typeof ctx.compact === 'number' && ctx.compact >= 1) {
            let entries = output.length;
            if (extrasType === kArrayExtrasType && entries > 6) output = groupArrayElements(ctx, output, value);
            if (ctx.currentDepth - recurseTimes < ctx.compact && entries === output.length) {
                let start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10;
                if (isBelowBreakLength(ctx, output, start, base)) {
                    let joined = output.join(', ');
                    if (joined.indexOf('\n') === -1) {
                        return `${base ? `${base} ` : ''}${braces[0]} ${joined} ${braces[1]}`;
                    }
                }
            }
        }
        let indentation = `\n${' '.repeat(ctx.indentationLvl)}`;
        return `${base ? `${base} ` : ''}${braces[0]}${indentation}  ${output.join(`,${indentation}  `)}${indentation}${braces[1]}`;
    }
    // compact === true: everything on one line unless it does not fit.
    if (isBelowBreakLength(ctx, output, 0, base)) {
        return `${braces[0]}${base ? ` ${base}` : ''} ${output.join(', ')} ${braces[1]}`;
    }
    let indentation = `\n${' '.repeat(ctx.indentationLvl)}`;
    let ln = base === '' && braces[0].length === 1 ? ' ' : `${base ? ` ${base}` : ''}\n${indentation}  `;
    return `${braces[0]}${ln}${output.join(`,\n${indentation}  `)} ${braces[1]}`;
}

function toNumberOption(value: unknown, fallback: number): number {
    if (value === null || value === Infinity) return Infinity;
    return typeof value === 'number' ? value : fallback;
}

/**
 * Return a string representation of `value` for debugging, like Node's util.inspect. The legacy signature
 * `inspect(value, showHidden, depth, colors)` is accepted too.
 */
function inspect(value: unknown, opts?: InspectOptions | boolean, depth?: number | null, _colors?: boolean): string {
    let options: InspectOptions = {};
    if (typeof opts === 'boolean') {
        options.showHidden = opts;
        if (depth !== undefined) options.depth = depth;
    } else if (opts !== null && typeof opts === 'object') {
        options = opts;
    }
    let defaults = inspect.defaultOptions;
    let ctx: Context = {
        showHidden: options.showHidden ?? defaults.showHidden,
        depth: toNumberOption(options.depth !== undefined ? options.depth : defaults.depth, 2),
        customInspect: options.customInspect ?? defaults.customInspect,
        maxArrayLength: toNumberOption(options.maxArrayLength !== undefined ? options.maxArrayLength : defaults.maxArrayLength, 100),
        maxStringLength: toNumberOption(options.maxStringLength !== undefined ? options.maxStringLength : defaults.maxStringLength, 10000),
        breakLength: options.breakLength ?? defaults.breakLength,
        compact: options.compact ?? defaults.compact,
        sorted: options.sorted ?? defaults.sorted,
        getters: !!(options.getters ?? defaults.getters),
        seen: [],
        circular: undefined,
        indentationLvl: 0,
        currentDepth: 0,
        userOptions: options,
    };
    return formatValue(ctx, value, 0);
}
inspect.custom = customInspect;
inspect.defaultOptions = defaultOptions;

// ── format ───────────────────────────────────────────────────────────────────────

/** Whether `value`'s toString is the one of a built-in (so %s inspects it instead). */
function hasBuiltInToString(value: object): boolean {
    let toStr: unknown;
    try { toStr = (value as any).toString; } catch { return true; }
    if (typeof toStr !== 'function') return true;
    if (Object.prototype.hasOwnProperty.call(value, 'toString')) return false;
    let pointer: any = value;
    do {
        pointer = Object.getPrototypeOf(pointer);
    } while (pointer !== null && !Object.prototype.hasOwnProperty.call(pointer, 'toString'));
    if (pointer === null) return true;
    let descriptor = Object.getOwnPropertyDescriptor(pointer, 'constructor');
    return descriptor !== undefined && typeof descriptor.value === 'function' &&
        builtInObjects[descriptor.value.name] === true;
}

function tryStringify(value: unknown): string {
    try {
        return JSON.stringify(value) as string;
    } catch (err) {
        let message = String((err as any)?.message ?? err);
        if (/circular|cyclic/i.test(message)) return '[Circular]';
        throw err;
    }
}

function withOptions(base: InspectOptions | undefined, extra: InspectOptions): InspectOptions {
    let out: Record<string, unknown> = {};
    if (base !== undefined) for (let key of Object.keys(base)) out[key] = (base as Record<string, unknown>)[key];
    for (let key of Object.keys(extra)) out[key] = (extra as Record<string, unknown>)[key];
    return out as InspectOptions;
}

function formatWithOptionsInternal(inspectOptions: InspectOptions | undefined, args: unknown[]): string {
    let first = args[0];
    let a = 0;
    let str = '';
    let join = '';

    if (typeof first === 'string') {
        if (args.length === 1) return first;
        let tempStr = '';
        let lastPos = 0;
        for (let i = 0; i < first.length - 1; i++) {
            if (first.charCodeAt(i) !== 37) continue; // '%'
            let nextChar = first.charAt(++i);
            if (a + 1 !== args.length) {
                switch (nextChar) {
                    case 's': {
                        let arg = args[++a];
                        if (typeof arg === 'number') tempStr = formatNumber(arg);
                        else if (typeof arg === 'bigint') tempStr = `${String(arg)}n`;
                        else if (typeof arg !== 'object' || arg === null || !hasBuiltInToString(arg)) tempStr = String(arg);
                        else tempStr = inspect(arg, withOptions(inspectOptions, { depth: 0, colors: false, compact: 3 }));
                        break;
                    }
                    case 'j': tempStr = tryStringify(args[++a]); break;
                    case 'd': {
                        let arg = args[++a];
                        if (typeof arg === 'bigint') tempStr = `${String(arg)}n`;
                        else if (typeof arg === 'symbol') tempStr = 'NaN';
                        else tempStr = formatNumber(Number(arg));
                        break;
                    }
                    case 'O': tempStr = inspect(args[++a], inspectOptions); break;
                    case 'o':
                        tempStr = inspect(args[++a], withOptions(inspectOptions, { showHidden: true, showProxy: true, depth: 4 }));
                        break;
                    case 'i': {
                        let arg = args[++a];
                        if (typeof arg === 'bigint') tempStr = `${String(arg)}n`;
                        else if (typeof arg === 'symbol') tempStr = 'NaN';
                        else tempStr = formatNumber(parseInt(String(arg), 10));
                        break;
                    }
                    case 'f': {
                        let arg = args[++a];
                        if (typeof arg === 'symbol') tempStr = 'NaN';
                        else tempStr = formatNumber(parseFloat(String(arg)));
                        break;
                    }
                    case 'c': a += 1; tempStr = ''; break;
                    case '%': str += first.slice(lastPos, i); lastPos = i + 1; continue;
                    default: continue;
                }
                if (lastPos !== i - 1) str += first.slice(lastPos, i - 1);
                str += tempStr;
                lastPos = i + 1;
            } else if (nextChar === '%') {
                str += first.slice(lastPos, i);
                lastPos = i + 1;
            }
        }
        if (lastPos !== 0) {
            a++;
            join = ' ';
            if (lastPos < first.length) str += first.slice(lastPos);
        }
    }

    while (a < args.length) {
        let value = args[a];
        str += join;
        str += typeof value !== 'string' ? inspect(value, inspectOptions) : value;
        join = ' ';
        a++;
    }
    return str;
}

/** printf-like formatting: %s %d %i %f %j %o %O %c %%; remaining arguments are appended (inspected unless strings). */
function format(...args: unknown[]): string {
    return formatWithOptionsInternal(undefined, args);
}

function formatWithOptions(inspectOptions: InspectOptions, ...args: unknown[]): string {
    if (inspectOptions === null || typeof inspectOptions !== 'object') {
        throw invalidArgType('inspectOptions', 'object', inspectOptions);
    }
    return formatWithOptionsInternal(inspectOptions, args);
}

// ── Misc ─────────────────────────────────────────────────────────────────────────

/** Legacy prototype inheritance: `ctor.prototype` inherits from `superCtor.prototype`. */
function inherits(ctor: Function, superCtor: Function): void {
    if (typeof ctor !== 'function') throw invalidArgType('ctor', 'function', ctor);
    if (typeof superCtor !== 'function') throw invalidArgType('superCtor', 'function', superCtor);
    if (superCtor.prototype === undefined) throw invalidArgType('superCtor.prototype', 'object', superCtor.prototype);
    Object.defineProperty(ctor, 'super_', { value: superCtor, writable: true, configurable: true });
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

/**
 * Turn a function taking a Node-style `(err, value) => …` callback as its last argument into one returning a Promise.
 * A function's own promise version can be given as `fn[util.promisify.custom]`.
 */
function promisify(original: Function): (...args: any[]) => Promise<any> {
    if (typeof original !== 'function') throw invalidArgType('original', 'function', original);
    let custom = (original as any)[customPromisify];
    if (typeof custom === 'function') return custom;
    let fn = function (this: unknown, ...args: any[]) {
        return new Promise((resolve, reject) => {
            original.apply(this, [...args, (err: unknown, value: unknown) => {
                if (err) reject(err); else resolve(value);
            }]);
        });
    };
    Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
    Object.defineProperty(fn, customPromisify, { value: fn, configurable: true });
    return fn;
}
promisify.custom = customPromisify;

/** ANSI codes per styleText format: [open, close]. */
const STYLES: Record<string, [number, number]> = {
    reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], blink: [5, 25],
    inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29],
    black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39],
    cyan: [36, 39], white: [37, 39], gray: [90, 39], grey: [90, 39],
    blackBright: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39],
    magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39],
    bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49],
    bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgGray: [100, 49], bgGrey: [100, 49],
    bgBlackBright: [100, 49], bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49],
    bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49],
};

/**
 * Wrap `text` in the ANSI escape codes of `format` (a style name or an array of them), e.g.
 * `styleText('red', 'error')`. process.stdout/stderr map the colours onto the terminal's 16 colours.
 */
function styleText(format: string | string[], text: string): string {
    if (typeof text !== 'string') throw invalidArgType('text', 'string', text);
    let formats = Array.isArray(format) ? format : [format];
    let left = '';
    let right = '';
    for (let name of formats) {
        let style = Object.prototype.hasOwnProperty.call(STYLES, name) ? STYLES[name] : undefined;
        if (style === undefined) {
            let err = new TypeError(`The argument 'format' must be one of: ${Object.keys(STYLES).join(', ')}. Received ${inspect(name)}`);
            (err as any).code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        left += `\x1b[${style[0]}m`;
        right = `\x1b[${style[1]}m` + right;
    }
    return `${left}${text}${right}`;
}

/** Whether two values are deeply strictly equal (own enumerable properties, same prototypes, Map/Set contents). */
function isDeepStrictEqual(a: unknown, b: unknown): boolean {
    return deepEqual(a, b, []);
}

function deepEqual(a: unknown, b: unknown, seen: [unknown, unknown][]): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    for (let pair of seen) if (pair[0] === a && pair[1] === b) return true;
    seen.push([a, b]);
    if (a instanceof Date) return (b as Date).getTime() === a.getTime();
    if (a instanceof RegExp) return String(a) === String(b);
    if (a instanceof Map) {
        let other = b as Map<unknown, unknown>;
        if (a.size !== other.size) return false;
        let equal = true;
        a.forEach((v, k) => { if (equal && (!other.has(k) || !deepEqual(v, other.get(k), seen))) equal = false; });
        return equal;
    }
    if (a instanceof Set) {
        let other = b as Set<unknown>;
        if (a.size !== other.size) return false;
        let equal = true;
        a.forEach((v) => { if (equal && !other.has(v)) equal = false; });
        return equal;
    }
    let keysA = Object.keys(a);
    let keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
    for (let key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual((a as any)[key], (b as any)[key], seen)) return false;
    }
    return true;
}

const util: UtilModule = {
    format,
    formatWithOptions,
    inspect,
    inherits,
    promisify,
    stripVTControlCharacters,
    styleText,
    isDeepStrictEqual,
};

export = util;
