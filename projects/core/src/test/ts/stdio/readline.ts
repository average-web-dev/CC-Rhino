// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

import prelude = require('./prelude');

const eq = prelude.eq, throws = prelude.throws, sink = prelude.sink, source = prelude.source;
const readline = require('readline');
const events = require('events');
const asyncMod = require('async');

eq(require('node:readline'), readline);
eq(readline.promises, require('readline/promises'));

interface OpenOptions {
    /** Width of the fake output stream (default 80). */
    columns?: number;
    historySize?: number;
    completer?: Completer;
}

/** A terminal-mode interface on a fake stream; returns it with the lines it emitted. */
function open(options?: OpenOptions) {
    let input = source();
    let output = sink(options && options.columns !== undefined ? options.columns : 80);
    let opts: InterfaceOptions = { input: input, output: output, terminal: true, prompt: '> ' };
    if (options && options.historySize !== undefined) opts.historySize = options.historySize;
    if (options && options.completer !== undefined) opts.completer = options.completer;
    let rl = readline.createInterface(opts);
    let lines: string[] = [];
    rl.on('line', function (line) { lines.push(line); });
    return { rl: rl, input: input, output: output, lines: lines, feed: function (data: string) { input.emit('data', data); } };
}

// Terminal mode puts the input in raw mode and closing restores it.
let t = open();
eq(t.input.isRaw, true);
t.feed('abc\r');
eq(t.lines.join('|'), 'abc');
eq(t.rl.history.join('|'), 'abc');

// Line editing
t.feed('helo\x1b[Dl\r');                       // left, insert
t.feed('world\x1b[Hx\x1b[F!\r');               // home, end
t.feed('abc\x7f\r');                            // backspace
t.feed('abc\x15d\r');                           // Ctrl+U: delete to the start
t.feed('foo bar\x17\r');                        // Ctrl+W: delete the word before the cursor
t.feed('foo bar\x1b[1;5DX\r');                  // Ctrl+Left: word left
t.feed('abcdef\x1b[D\x1b[D\x0b\r');             // Ctrl+K: delete to the end
t.feed('abc\x01\x1b[3~\r');                     // Ctrl+A, Delete
t.feed('ab\x01\x06X\r');                        // Ctrl+A, Ctrl+F (right)
t.feed('one two\x1bb\x1bdX\r');                 // Meta+B, Meta+D (delete word right)
eq(t.lines.slice(1).join('|'), 'hello|xworld!|ab|d|foo |foo Xbar|abcd|bc|aXb|one X');

// The cursor position accounts for the prompt and wraps at the output's width.
t.rl.write('abc');
eq(JSON.stringify(t.rl.getCursorPos()), '{"cols":5,"rows":0}');
t.rl.write(null, { ctrl: true, name: 'u' });
eq(t.rl.line, '');
const small = open({ columns: 4 });
small.rl.write('abc');
eq(JSON.stringify(small.rl.getCursorPos()), '{"cols":1,"rows":1}');

// History: newest first, Up/Down, prefix search, consecutive duplicates collapsed, historySize
t = open({ historySize: 3 });
t.feed('one\r');
t.feed('two\r');
t.feed('two\r');
eq(t.rl.history.join('|'), 'two|one');
t.feed('\x1b[A\x1b[A\r');
eq(t.lines[t.lines.length - 1], 'one');
t.feed('t\x1b[A\r');
eq(t.lines[t.lines.length - 1], 'two', 'Up searches for what was typed');
t.feed('x\x1b[A\x1b[B\r');
eq(t.lines[t.lines.length - 1], 'x', 'Down past the newest entry restores the typed text');
t.feed('a\rb\rc\r');
eq(t.rl.history.length, 3);
let historyEvents = 0;
t.rl.on('history', function () { historyEvents++; });
t.feed('d\r');
eq(historyEvents, 1);

// Tab completion
const completions = ['apple', 'apricot', 'banana'];
t = open({
    completer: function (line: string): CompleterResult {
        return [completions.filter(function (c) { return c.indexOf(line) === 0; }), line];
    },
});
t.feed('b\t\r');
eq(t.lines[0], 'banana');
t.feed('ap\t');
eq(t.rl.line, 'ap', 'no longer common prefix');
eq(t.output.out.indexOf('apricot'), -1, 'the first Tab does not list');
t.feed('\t');
assert(t.output.out.indexOf('apple    apricot') !== -1, 'the second Tab lists: ' + JSON.stringify(t.output.out));
t.feed('r\t\r');
eq(t.lines[1], 'apricot');
t = open({
    completer: function (line: string, callback: (err: Error | null, result?: CompleterResult) => void) {
        callback(null, [['callback'], line]);
    },
});
t.feed('c\t\r');
eq(t.lines[0], 'callback');

// question with a callback: answered by the next line, which is not emitted as 'line'
t = open();
const answers: string[] = [];
t.rl.question('Name? ', function (answer) { answers.push(answer); });
eq(t.rl.getPrompt(), 'Name? ');
t.feed('Bob\r');
eq(answers.join('|'), 'Bob');
eq(t.lines.length, 0);
eq(t.rl.getPrompt(), '> ');

// question without a callback blocks until the answer arrives
events.setImmediate(function () { t.feed('Ann\r'); });
eq(t.rl.question('Who? '), 'Ann');

// Async iteration
const iterator = t.rl[Symbol.asyncIterator]();
t.feed('it\r');
eq(JSON.stringify(asyncMod.unwrap(iterator.next())), '{"value":"it","done":false}');

// Ctrl+C: SIGINT if anyone listens, otherwise close
let sigints = 0;
t.rl.on('SIGINT', function () { sigints++; });
t.feed('\x03');
eq(sigints, 1);
eq(t.rl.closed, false);
let closed = 0;
t = open();
t.rl.on('close', function () { closed++; });
t.feed('\x03');
eq(closed, 1);
eq(t.input.isRaw, false, 'close leaves raw mode');
throws(function () { t.rl.question('?'); }, 'ERR_USE_AFTER_CLOSE');
t.feed('ignored\r');
eq(t.lines.length, 0, 'a closed interface removed its listeners');

// Ctrl+D closes on an empty line only
t = open();
t.feed('ab\x01\x04\r');
eq(t.lines[0], 'b');
t.feed('\x04');
eq(t.rl.closed, true);

// A paused interface ignores input; prompt() resumes it.
t = open();
t.rl.pause();
eq(t.input.paused, true);
t.feed('skipped\r');
eq(t.lines.length, 0);
t.rl.prompt();
eq(t.input.paused, false);
t.feed('seen\r');
eq(t.lines.join('|'), 'seen');

// Rendering: typing at the end is echoed; prompt() draws the prompt at the left edge.
t = open();
t.output.out = '';
t.rl.prompt();
eq(t.output.out, '\x1b[1G\x1b[0J> \x1b[3G');
t.output.out = '';
t.feed('hi');
eq(t.output.out, 'hi');
t.output.out = '';
t.feed('\r');
eq(t.output.out, '\r\n');

// Non-terminal mode splits 'data' into lines (\n, \r\n, \r); 'end' flushes the rest and closes.
let input = source();
const rl = readline.createInterface({ input: input, terminal: false });
const plain: string[] = [];
rl.on('line', function (line) { plain.push(line); });
input.emit('data', 'a\nb\r\nc\rd');
input.emit('data', 'e\n');
input.emit('data', 'tail');
input.emit('end');
eq(plain.join('|'), 'a|b|c|de|tail');
eq(rl.closed, true);

// readline/promises: question returns a promise; closing rejects a pending one.
const readlinePromises = require('readline/promises');
input = source();
const rlp = readlinePromises.createInterface({ input: input, output: sink(80), terminal: true });
events.setImmediate(function () { input.emit('data', 'yes\r'); });
eq(asyncMod.unwrap(rlp.question('Sure? ')), 'yes');
const pending = rlp.question('Again? ');
rlp.close();
const aborted = throws(function () { asyncMod.unwrap(pending); }, 'ABORT_ERR');
eq(aborted.name, 'AbortError');
assert(rlp instanceof readline.Interface, 'promises interfaces are readline interfaces');

// The module-level cursor functions write VT sequences.
const cursor = sink(80);
readline.cursorTo(cursor, 2, 3);
readline.moveCursor(cursor, -1, 1);
readline.clearLine(cursor, 0);
readline.clearScreenDown(cursor);
eq(cursor.out, '\x1b[4;3H\x1b[1D\x1b[1B\x1b[2K\x1b[0J');

// emitKeypressEvents decodes VT input into keys.
const keyInput = source();
readline.emitKeypressEvents(keyInput);
const keys: string[] = [];
keyInput.on('keypress', function (s: string | undefined, key: Key) {
    keys.push((key.ctrl ? 'C-' : '') + (key.meta ? 'M-' : '') + (key.shift ? 'S-' : '') + key.name);
});
keyInput.emit('data', 'aB\r\x1b[A\x1b[1;5C\x03\x1bx\x1b[3~\t\x1b[Z');
eq(keys.join(' '), 'a S-b return up C-right C-c M-x delete tab S-tab');
