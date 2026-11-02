// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// js — a JavaScript REPL, like `node` without arguments (#3):
//
//   > 1 + 1                     2  (the result, util.inspect'ed, coloured on a colour terminal; also in `_`)
//   > let fs = require('fs')    declarations stay for the next lines (they are globals)
//   > Math.fl<Tab>              completes globals and properties
//   > function f() {            an unfinished line goes on at `... `
//   .help / .break / .exit      commands; Ctrl+C clears the line (twice on an empty line exits), Ctrl+D exits
//
// An expression runs as a function (`new Function('return (…)')`), so it may call blocking APIs (`sleep`, peripherals,
// …); statements run through an indirect eval, so their declarations stay — blocking calls are not possible there
// (Rhino cannot pause inside eval). The input is run as it is, not compiled by Babel: what Rhino does not support
// natively (`class`, `async` / `await`) does not work here.

import readline from 'readline';
import util from 'util';
import { Key } from '/rom/lib/tty';

const evaluate = eval;
/** The global object: where the REPL's variables live. */
const globalObject = evaluate('this') as Record<string, unknown>;

const HELP = [
    '.break    Leave an unfinished input',
    '.exit     Exit the REPL',
    '.help     Print this help',
    '',
    'Press Ctrl+C to abort the current input, Ctrl+D to exit.',
].join('\n');

/** How many brackets the input leaves open (strings, template literals and comments skipped; -1: an open template). */
function openBrackets(code: string): number {
    let depth = 0;
    let i = 0;
    while (i < code.length) {
        let ch = code.charAt(i);
        if (ch === '/' && code.charAt(i + 1) === '/') {
            let end = code.indexOf('\n', i);
            i = end < 0 ? code.length : end;
        } else if (ch === '/' && code.charAt(i + 1) === '*') {
            let end = code.indexOf('*/', i + 2);
            if (end < 0) return -1;
            i = end + 2;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            i++;
            while (i < code.length && code.charAt(i) !== ch) {
                if (code.charAt(i) === '\\') i++;
                else if (code.charAt(i) === '\n' && ch !== '`') break;
                i++;
            }
            if (i >= code.length && ch === '`') return -1;
            i++;
        } else {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth--;
            i++;
        }
    }
    return depth;
}

/** Whether `code` is unfinished: open brackets, an open template literal or comment. */
function isIncomplete(code: string): boolean {
    let open = openBrackets(code);
    return open > 0 || open === -1;
}

/** `return (…)` as a function, or undefined if `code` is no expression. */
function asExpression(code: string): (() => unknown) | undefined {
    try {
        return new Function(`return (${code}\n);`) as () => unknown;
    } catch {
        return undefined;
    }
}

const DECLARATION = /^\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+?)\s*;?\s*$/;

/** Run one input: the value of an expression, or of the statements (eval). */
function run(code: string): unknown {
    let source = code.replace(/;\s*$/, '');
    // A function declaration is a statement, though it would parse as an expression.
    if (!/^\s*function\b/.test(source)) {
        let expression = asExpression(source);
        if (expression !== undefined) return expression();
        // `let x = <expression>`: the expression as a function too (it may block), the name a global.
        let declaration = DECLARATION.exec(code);
        let value = declaration === null ? undefined : asExpression(declaration[2]);
        if (declaration !== null && value !== undefined) {
            globalObject[declaration[1]] = value();
            return undefined;
        }
    }
    return evaluate(code);
}

/** The names a value offers: its properties and those of its prototypes. */
function namesOf(value: unknown): string[] {
    let names = new Set<string>();
    let object: unknown = value;
    if (object === null || object === undefined) return [];
    if (typeof object !== 'object' && typeof object !== 'function') object = Object(object);
    while (object !== null && object !== undefined) {
        for (let name of Object.getOwnPropertyNames(object)) names.add(name);
        object = Object.getPrototypeOf(object);
    }
    return Array.from(names);
}

/** readline completer: globals, or the properties of the value before the last `.`. */
function completer(line: string): [string[], string] {
    let match = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)?(\.)?([A-Za-z_$][\w$]*)?$/.exec(line);
    let path = match?.[1] ?? '';
    let dot = match?.[2] === '.';
    let partial = match?.[3] ?? '';
    if (!dot && path !== '') {
        // `Math` without a dot: complete the last name of the path itself.
        let last = path.lastIndexOf('.');
        partial = path.slice(last + 1);
        path = last < 0 ? '' : path.slice(0, last);
        dot = last >= 0;
    }
    let names: string[];
    if (!dot) {
        names = namesOf(globalObject);
    } else {
        let target: unknown;
        try {
            target = evaluate(path);
        } catch {
            return [[], partial];
        }
        names = namesOf(target);
    }
    let hits = names.filter((name) => name.startsWith(partial) && /^[A-Za-z_$][\w$]*$/.test(name)).sort();
    return [hits, partial];
}

export function main(): void {
    let colors = process.stdout.isTTY && process.stdout.hasColors();
    let show = (value: unknown) => util.inspect(value, { colors, breakLength: process.stdout.columns });
    let buffer = '';
    let interrupted = false;

    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer,
        historySize: 100,
        prompt: '> ',
    });

    let prompt = () => {
        rl.setPrompt(buffer === '' ? '> ' : '... ');
        rl.prompt();
    };

    rl.on('line', (line: string) => {
        interrupted = false;
        if (buffer === '' && line.trim().startsWith('.')) {
            let command = line.trim();
            if (command === '.exit') return rl.close();
            if (command === '.help') console.log(HELP);
            else if (command !== '.break') console.error(`Invalid REPL keyword: ${command}`);
            return prompt();
        }
        if (line.trim() === '.break') {
            buffer = '';
            return prompt();
        }
        buffer += (buffer === '' ? '' : '\n') + line;
        if (buffer.trim() === '') {
            buffer = '';
            return prompt();
        }
        if (isIncomplete(buffer)) return prompt();

        let code = buffer;
        buffer = '';
        try {
            let value = run(code);
            globalObject._ = value;
            console.log(show(value));
        } catch (error) {
            globalObject._error = error;
            console.error('Uncaught ' + show(error));
        }
        prompt();
    });

    rl.on('SIGINT', () => {
        let empty = rl.line === '' && buffer === '';
        rl.write(null, { ctrlKey: true, code: Key.KEY_E });
        process.stdout.write('^C\n');
        rl.clearLine();
        buffer = '';
        if (empty) {
            if (interrupted) return rl.close();
            interrupted = true;
            console.log('(To exit, press Ctrl+C again or Ctrl+D or type .exit)');
        }
        prompt();
    });

    rl.on('close', () => process.exit());

    console.log(`Welcome to the JavaScript REPL (Rhino). Type ".help" for more information.`);
    prompt();
}
