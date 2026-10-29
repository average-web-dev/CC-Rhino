// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/console.ts — Node's console (lib/internal/console/constructor.js): a Console class writing formatted
// messages to two streams, and the global console writing to process.stdout / process.stderr.
//
// `require('console')` returns the global console, whose `Console` property is the class — as in Node.
//
// Differences from Node: console.table draws its borders with ASCII characters (the terminal font has no box-drawing
// characters); inspected values break lines at the terminal width rather than at 80 columns; there is no colour mode.

import util = require('/rom/lib/util');
import proc = require('/rom/lib/process');
import callable = require('/rom/lib/internal/callable');

const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

function pad(value: number | string): string {
    return String(value).padStart(2, '0');
}

/** Node's formatTime: "1.234ms", "1.500s", "1:02.345 (m:ss.mmm)", "1:02:03.456 (h:mm:ss.mmm)". */
function formatTime(ms: number): string {
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (ms >= kSecond) {
        if (ms >= kMinute) {
            if (ms >= kHour) {
                hours = Math.floor(ms / kHour);
                ms = ms % kHour;
            }
            minutes = Math.floor(ms / kMinute);
            ms = ms % kMinute;
        }
        seconds = ms / kSecond;
    }
    if (hours !== 0 || minutes !== 0) {
        let parts = seconds.toFixed(3).split('.');
        let res = hours !== 0 ? `${hours}:${pad(minutes)}` : String(minutes);
        return `${res}:${pad(parts[0])}.${parts[1]} (${hours !== 0 ? 'h:m' : ''}m:ss.mmm)`;
    }
    if (seconds !== 0) return `${seconds.toFixed(3)}s`;
    return `${Number(ms.toFixed(3))}ms`;
}

function invalidArg(name: string, expected: string): TypeError {
    let err = new TypeError(`The "${name}" argument must be ${expected}`);
    (err as any).code = 'ERR_CONSOLE_WRITABLE_STREAM';
    return err;
}

function isWritable(stream: unknown): stream is ConsoleStream {
    return stream !== null && typeof stream === 'object' && typeof (stream as ConsoleStream).write === 'function';
}

// ── ASCII table (lib/internal/cli_table.js) ─────────────────────────────────────

function renderRow(row: string[], widths: number[]): string {
    let out = '| ';
    for (let i = 0; i < row.length; i++) {
        let cell = row[i];
        let needed = (widths[i] - cell.length) / 2;
        out += ' '.repeat(Math.floor(needed)) + cell + ' '.repeat(Math.ceil(needed));
        if (i !== row.length - 1) out += ' | ';
    }
    return out + ' |';
}

function renderTable(head: string[], columns: string[][]): string {
    let rows: string[][] = [];
    let widths: number[] = [];
    let longest = 0;
    for (let column of columns) if (column.length > longest) longest = column.length;
    for (let i = 0; i < head.length; i++) {
        widths.push(head[i].length);
        let column = columns[i];
        for (let j = 0; j < longest; j++) {
            if (rows[j] === undefined) rows[j] = [];
            let value = Object.prototype.hasOwnProperty.call(column, j) ? column[j] : '';
            rows[j][i] = value;
            if (value.length > widths[i]) widths[i] = value.length;
        }
    }
    let dividers: string[] = [];
    for (let width of widths) dividers.push('-'.repeat(width + 2));
    let divider = '+' + dividers.join('+') + '+';
    let result = divider + '\n' + renderRow(head, widths) + '\n' + divider + '\n';
    for (let row of rows) result += renderRow(row, widths) + '\n';
    return result + divider;
}

// ── Console ──────────────────────────────────────────────────────────────────────

function inspectOptionsFor(self: Console, stream: ConsoleStream): InspectOptions | undefined {
    if (self._inspectOptions !== undefined) return self._inspectOptions;
    // Break lines at the terminal width rather than at 80 columns.
    if (stream.isTTY && typeof stream.columns === 'number' && stream.columns > 0) return { breakLength: stream.columns };
    return undefined;
}

function formatFor(self: Console, stream: ConsoleStream, args: unknown[]): string {
    let options = inspectOptionsFor(self, stream);
    return options === undefined ? util.format(...args) : util.formatWithOptions(options, ...args);
}

function writeTo(self: Console, useStdout: boolean, text: string): void {
    let stream = useStdout ? self._stdout : self._stderr;
    let indent = self._groupIndent;
    if (indent.length !== 0) {
        if (text.indexOf('\n') !== -1) text = text.replace(/\n/g, `\n${indent}`);
        text = indent + text;
    }
    text += '\n';
    if (!self._ignoreErrors) { stream.write(text); return; }
    try {
        stream.write(text);
    } catch (e) {
        // Like Node, write errors are ignored unless ignoreErrors is false.
    }
}

/** console.log / console.error: format `data` and write it to stdout or stderr. */
function print(self: Console, useStdout: boolean, data: unknown[]): void {
    writeTo(self, useStdout, formatFor(self, useStdout ? self._stdout : self._stderr, data));
}

class Console {
    declare _stdout: ConsoleStream;
    declare _stderr: ConsoleStream;
    declare _ignoreErrors: boolean;
    declare _inspectOptions: InspectOptions | undefined;
    declare _groupIndentation: number;
    declare _groupIndent: string;
    declare _counts: Map<string, number>;
    declare _timers: Map<string, number>;

    constructor(options?: ConsoleOptions | ConsoleStream, stderr?: ConsoleStream, ignoreErrors?: boolean) {
        let opts: ConsoleOptions;
        if (options === undefined || isWritable(options)) {
            opts = { stdout: options as ConsoleStream, stderr, ignoreErrors };
        } else {
            opts = options;
        }
        let stdout = opts.stdout;
        let errStream = opts.stderr === undefined ? stdout : opts.stderr;
        if (!isWritable(stdout)) throw invalidArg('stdout', 'a writable stream');
        if (!isWritable(errStream)) throw invalidArg('stderr', 'a writable stream');
        let groupIndentation = opts.groupIndentation === undefined ? 2 : opts.groupIndentation;
        if (typeof groupIndentation !== 'number' || groupIndentation < 0 || groupIndentation > 1000) {
            let err = new RangeError('The value of "groupIndentation" is out of range. It must be >= 0 && <= 1000');
            (err as any).code = 'ERR_OUT_OF_RANGE';
            throw err;
        }

        let hidden = (name: string, value: unknown) =>
            Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: false });
        hidden('_stdout', stdout);
        hidden('_stderr', errStream);
        hidden('_ignoreErrors', opts.ignoreErrors !== false);
        hidden('_inspectOptions', opts.inspectOptions);
        hidden('_groupIndentation', groupIndentation);
        hidden('_groupIndent', '');
        hidden('_counts', new Map());
        hidden('_timers', new Map());

        // Like Node, the methods are bound to the instance, so `const { log } = console` works.
        let proto = Console.prototype as unknown as Record<string, unknown>;
        for (const key of Object.keys(proto)) {
            let method = proto[key];
            if (typeof method === 'function') (this as unknown as Record<string, unknown>)[key] = method.bind(this);
        }
    }

    log(...data: unknown[]): void {
        print(this, true, data);
    }

    warn(...data: unknown[]): void {
        print(this, false, data);
    }

    dir(object: unknown, options?: InspectOptions): void {
        writeTo(this, true, util.inspect(object, { customInspect: false, ...inspectOptionsFor(this, this._stdout), ...options }));
    }

    trace(...data: unknown[]): void {
        let message = formatFor(this, this._stderr, data);
        let frames = String(new Error().stack ?? '').split('\n');
        let lines: string[] = [];
        for (let frame of frames) {
            frame = frame.trim();
            // Leave out the frames of the console itself.
            if (frame !== '' && frame.indexOf('/rom/lib/console.js') === -1) lines.push('    ' + frame);
        }
        writeTo(this, false, 'Trace' + (message === '' ? '' : ': ' + message) + (lines.length > 0 ? '\n' + lines.join('\n') : ''));
    }

    assert(expression: unknown, ...data: unknown[]): void {
        if (expression) return;
        // As in Node, the first argument is stringified into the message, the rest are formatted by warn().
        data[0] = `Assertion failed${data.length === 0 ? '' : `: ${data[0]}`}`;
        print(this, false, data);
    }

    clear(): void {
        let stream = this._stdout;
        if (stream.isTTY) stream.write('\x1b[1;1H\x1b[0J');
    }

    count(label: unknown = 'default'): void {
        let key = `${label}`;
        let count = (this._counts.get(key) ?? 0) + 1;
        this._counts.set(key, count);
        print(this, true, [`${key}: ${count}`]);
    }

    countReset(label: unknown = 'default'): void {
        let key = `${label}`;
        if (!this._counts.has(key)) {
            proc.emitWarning(`Count for '${key}' does not exist`);
            return;
        }
        this._counts.delete(key);
    }

    group(...data: unknown[]): void {
        if (data.length > 0) print(this, true, data);
        this._groupIndent += ' '.repeat(this._groupIndentation);
    }

    groupCollapsed(...data: unknown[]): void {
        Console.prototype.group.apply(this, data);
    }

    groupEnd(): void {
        this._groupIndent = this._groupIndent.slice(0, Math.max(0, this._groupIndent.length - this._groupIndentation));
    }

    time(label: unknown = 'default'): void {
        let key = `${label}`;
        if (this._timers.has(key)) {
            proc.emitWarning(`Label '${key}' already exists for console.time()`);
            return;
        }
        this._timers.set(key, Date.now());
    }

    timeEnd(label: unknown = 'default'): void {
        let key = `${label}`;
        let start = this._timers.get(key);
        if (start === undefined) {
            proc.emitWarning(`No such label '${key}' for console.timeEnd()`);
            return;
        }
        this._timers.delete(key);
        print(this, true, ['%s: %s', key, formatTime(Date.now() - start)]);
    }

    timeLog(label?: unknown, ...data: unknown[]): void {
        let key = `${label === undefined ? 'default' : label}`;
        let start = this._timers.get(key);
        if (start === undefined) {
            proc.emitWarning(`No such label '${key}' for console.timeLog()`);
            return;
        }
        print(this, true, ['%s: %s', key, formatTime(Date.now() - start), ...data]);
    }

    table(tabularData: unknown, properties?: string[]): void {
        if (properties !== undefined && !Array.isArray(properties)) {
            let err = new TypeError('The "properties" argument must be an instance of Array');
            (err as any).code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (tabularData === null || typeof tabularData !== 'object') {
            print(this, true, [tabularData]);
            return;
        }

        let base = inspectOptionsFor(this, this._stdout);
        let show = (v: unknown): string => {
            let depth = v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 2 ? -1 : 0;
            let options: InspectOptions = { depth, maxArrayLength: 3, ...base };
            options.breakLength = Infinity;
            return util.inspect(v, options);
        };
        let indexArray = (length: number): string[] => {
            let out: string[] = [];
            for (let i = 0; i < length; i++) out.push(show(i));
            return out;
        };
        let output = (head: string[], columns: string[][]) => print(this, true, [renderTable(head, columns)]);

        if (tabularData instanceof Map) {
            let keys: string[] = [];
            let values: string[] = [];
            tabularData.forEach((v, k) => { keys.push(show(k)); values.push(show(v)); });
            output(['(iteration index)', 'Key', 'Values'], [indexArray(keys.length), keys, values]);
            return;
        }
        if (tabularData instanceof Set) {
            let values: string[] = [];
            tabularData.forEach((v) => { values.push(show(v)); });
            output(['(iteration index)', 'Values'], [indexArray(values.length), values]);
            return;
        }

        let map: Record<string, string[]> = Object.create(null);
        let order: string[] = [];
        let hasPrimitives = false;
        let valuesColumn: string[] = [];
        let indexKeys = Object.keys(tabularData);
        for (let i = 0; i < indexKeys.length; i++) {
            let item = (tabularData as Record<string, unknown>)[indexKeys[i]];
            let primitive = item === null || (typeof item !== 'function' && typeof item !== 'object');
            if (properties === undefined && primitive) {
                hasPrimitives = true;
                valuesColumn[i] = show(item);
            } else {
                let keys = properties ?? Object.keys(item as object);
                for (let key of keys) {
                    if (map[key] === undefined) { map[key] = []; order.push(key); }
                    if ((primitive && properties) || !Object.prototype.hasOwnProperty.call(item, key)) map[key][i] = '';
                    else map[key][i] = show((item as Record<string, unknown>)[key]);
                }
            }
        }
        let head = ['(index)', ...order];
        let columns: string[][] = [indexKeys, ...order.map((key) => map[key])];
        if (hasPrimitives) { head.push('Values'); columns.push(valuesColumn); }
        output(head, columns);
    }
}

// As in Node, the methods are enumerable (the constructor binds every enumerable one), and info/debug/dirxml and
// error are the same functions as log and warn.
{
    let proto = Console.prototype as unknown as Record<string, unknown>;
    let aliases: Record<string, string> = { info: 'log', debug: 'log', dirxml: 'log', error: 'warn' };
    let names = ['log', 'info', 'debug', 'dirxml', 'warn', 'error', 'dir', 'trace', 'assert', 'clear', 'count',
        'countReset', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog', 'table'];
    for (const name of names) {
        let value = proto[aliases[name] ?? name];
        delete proto[name];
        Object.defineProperty(proto, name, { value, writable: true, configurable: true, enumerable: true });
    }
}

const globalConsole = new Console({ stdout: proc.stdout, stderr: proc.stderr }) as unknown as GlobalConsole;
// Like Node's Console, `console.Console` also works without `new`.
Object.defineProperty(globalConsole, 'Console', {
    value: callable(Console), writable: true, configurable: true, enumerable: false,
});

export = globalConsole;
