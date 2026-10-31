// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The tty module (Node streams over native TTYs) and Term, on virtual TTYs. Run by StdioLibraryTest.

import * as prelude from './prelude';
import asyncMod from 'async';
import { TTY, ReadStream, WriteStream, isatty } from 'tty';
import { Term } from 'term';

const eq = prelude.eq, throws = prelude.throws;

/** Compare arrays and plain objects by value. */
function same(actual: unknown, expected: unknown, message?: string): void {
    eq(JSON.stringify(actual), JSON.stringify(expected), message);
}

eq(require('node:tty'), require('tty'));
eq(isatty(1), true);
eq(isatty(5), false);
eq(process.stdin instanceof ReadStream, true, 'process.stdin is a tty.ReadStream');
eq(process.stdout instanceof WriteStream, true, 'process.stdout is a tty.WriteStream');

// ── A virtual TTY: what a program writes is read by whoever holds it ─────────────────────────────────────────────────

const t = new TTY(10, 3);
same([t.columns, t.rows], [10, 3]);
eq(t.stdout.columns, 10);
eq(t.cursorColumn(), undefined, 'a virtual TTY is not shown anywhere');
t.stdout.write('hello');
t.stderr.write('oops');
eq(t.readOutput(), 'hello');
eq(t.readErrorOutput(), 'oops');
// 'resize' fires (on a later tick) when the TTY changes its size, and only on the streams of that TTY.
const other = new TTY(5, 2);
let otherResized = 0;
other.stdout.on('resize', () => { otherResized++; });
const resized = new Promise<number>((resolve) => {
    t.stdout.once('resize', function (this: TtyWriteStream) { resolve(this.columns); });
});
eq(t.stdout.listenerCount('resize'), 1);
t.setSize(10, 3);
t.setSize(20, 4);
eq(t.columns, 20);
eq(asyncMod.unwrap(resized), 20);
eq(t.stdout.listenerCount('resize'), 0, 'once removes itself');
eq(otherResized, 0, 'other TTYs do not see it');
other.stdout.removeAllListeners('resize');
eq(other.stdout.listenerCount('resize'), 0);

// Typing into it passes the line discipline: cooked mode echoes and delivers whole lines.
const lines: string[] = [];
const ended: boolean[] = [];
t.stdin.on('data', (d: string) => { lines.push(d); });
t.stdin.on('end', () => { ended.push(true); });
eq(t.stdin.readableFlowing, true, "a 'data' listener starts the flow");
t.input('ab\x7fc\r');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(lines, ['ac\n']);
eq(t.readOutput(), 'ab\b \bc\n', 'echo');

// Paused, input stays in the TTY until the stream flows again.
t.stdin.pause();
t.input('later\r');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
eq(lines.length, 1, 'nothing delivered while paused');
t.stdin.resume();
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(lines, ['ac\n', 'later\n']);

t.input('\x04');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(ended, [true], 'Ctrl+D on an empty line ends the input');

// Raw mode passes keys through; 'keypress' decodes them.
const keys: string[] = [];
t.setRawMode(true);
eq(t.isRaw, true);
t.stdin.on('keypress', (_s: string | undefined, key: Key) => { keys.push(`${key.ctrl ? 'C-' : ''}${key.name}`); });
t.input('\x1b[A\x03x\x1b[<0;3;4M');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(keys, ['up', 'C-c', 'x'], 'mouse reports are not keys');
t.setRawMode(false);
t.stdin.pause();
t.readOutput();

// ── Term on a virtual TTY ────────────────────────────────────────────────────────────────────────────────────────

const v = new TTY(5, 3);
const term = new Term(v);
eq(term.tty, v);
same(term.getSize(), { width: 5, height: 3 });

term.write('ab');
eq(v.readOutput(), 'ab', 'default colours: plain text');
same(term.getCursorPos(), { x: 2, y: 0 });

term.write('cdefg');
eq(v.readOutput(), 'cde\r\nfg', 'wraps at the width');
same(term.getCursorPos(), { x: 2, y: 1 });

term.setTextColor(16384);
term.setBackgroundColor(4096);
term.write('x');
eq(v.readOutput(), '\x1b[38;6;14;48;6;12mx\x1b[0m', 'colours apply to this write only');
same([term.getTextColor(), term.getBackgroundColor()], [16384, 4096]);
throws(() => term.setTextColor(3));

term.setCursorPos({ x: 0, y: 2 });
term.blit('hi', '0e', 'ff');
eq(v.readOutput(), '\x1b[3;1H\x1bPcc-blit;0e;ff;hi\x1b\\');
same(term.getCursorPos(), { x: 2, y: 2 });
throws(() => term.blit('a', '00', 'f'));

term.setSize(3, 2);
same(term.getSize(), { width: 3, height: 2 });

term.setCursorBlink(true);
eq(v.readOutput(), '\x1b[?25h');

// Input: keys, characters and lines; mouse reports are dropped.
v.setRawMode(true);
v.input('\x1b[<0;1;1Mq\x1b[Bz');
eq(term.readKey()!.name, 'q');
eq(term.readKey()!.name, 'down');
eq(term.readChar(), 'z');
v.setRawMode(false);
v.input('first\rsecond\r');
eq(term.readLine(), 'first');
eq(term.readLine(), 'second');
