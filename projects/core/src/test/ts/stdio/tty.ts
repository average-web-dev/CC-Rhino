// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The tty module (Node streams over native TTYs) and Term, on virtual TTYs. Run by StdioLibraryTest.

import * as prelude from './prelude';
import asyncMod from 'async';
import { CSI, TTY, ReadStream, WriteStream, isatty, decodeInput, InputType, MouseAction, MouseButton } from 'tty';
import { Term, Key, ColorIndex } from 'term';
import { Color } from 'color';
import events from 'events';
import util from 'util';

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

// Raw mode passes keys through; 'keydown' decodes them.
const keys: string[] = [];
t.setRawMode(true);
eq(t.isRaw, true);
t.stdin.on('keydown', (key: TtyKeyInput) => { keys.push(`${key.ctrlKey ? 'C-' : ''}${key.code}`); });
t.input('\x1b[A\x03x\x1b[<0;3;4M');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(keys, ['ArrowUp', 'C-KeyC', 'KeyX'], 'mouse reports are not keys');
// Kitty-encoded keys give the same events; releases are 'keyup', not 'keydown'.
keys.length = 0;
t.input('\x1b[99;5u\x1b[13u\x1b[13;1:3u\x1b[1;1:2A');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(keys, ['C-KeyC', 'Enter', 'ArrowUp']);
t.stdin.removeAllListeners('keydown');
// Mouse reports and bracketed pastes are events of their own, in order with the keys.
const inputs: string[] = [];
t.stdin.on('mouse', (m: TtyMouseInput) => { inputs.push(`mouse ${m.action} ${m.x},${m.y}`); });
t.stdin.on('paste', (p: TtyPasteInput) => { inputs.push(`paste ${p.text}`); });
t.stdin.on('keydown', (k: TtyKeyInput) => { inputs.push(`key ${k.code}`); });
t.input('a\x1b[<0;3;4M\x1b[200~hi\x1b[201~b');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(inputs, ['key KeyA', 'mouse press 2,3', 'paste hi', 'key KeyB']);
t.stdin.removeAllListeners('mouse');
t.stdin.removeAllListeners('paste');
t.stdin.removeAllListeners('keydown');
t.setRawMode(false);
t.stdin.pause();
t.readOutput();

// 'keydown' / 'keyup' (like the browser's), in the order typed across listeners, even within one chunk of input.
// (A TTY shown on a device asks its terminal for the kitty protocol in raw mode; a virtual one gets what is typed.)
const keyEvents: string[] = [];
const onKeyUp = (e: TtyKeyInput) => { keyEvents.push(`up ${e.code}`); };
t.stdin.on('keyup', onKeyUp);
t.stdin.on('keydown', (e: TtyKeyInput) => { keyEvents.push(`down ${e.code} ${e.key}${e.repeat ? ' repeat' : ''}`); });
const dataSeen: string[] = [];
t.stdin.on('data', (chunk: string) => { dataSeen.push(chunk); });
t.stdin.resume(); // paused above
eq(t.stdin.getKeyboardProtocol(), 'kitty', 'the default');
t.setRawMode(true);
t.input('\x1b[97;2;65u\x1b[97;2:2;65u\x1b[97;2:3u\x1b[57441;2:3u\x1b[99;5u\x1b[1;1:3A');
asyncMod.unwrap(new Promise<void>((resolve) => setTimeout(resolve, 1)));
same(keyEvents, ['down KeyA A', 'down KeyA A repeat', 'up KeyA', 'up ShiftLeft', 'down KeyC c', 'up ArrowUp']);
same(dataSeen, ['AA\x03'], "'data' gets the keys as a terminal traditionally sends them: presses, as text");
t.stdin.removeAllListeners('keydown');
t.stdin.removeAllListeners('data');
t.stdin.off('keyup', onKeyUp);
t.stdin.pause(); // so the input stays in the TTY for readSync
t.input('\x1b[98u\x1b[98;1:3u\x1b[1;5A');
eq(t.stdin.readSync(), 'b\x1b[1;5A', 'readSync too');
throws(() => t.stdin.setKeyboardProtocol('vt' as any), 'ERR_INVALID_ARG_VALUE');
t.stdin.setKeyboardProtocol('legacy');
eq(t.stdin.getKeyboardProtocol(), 'legacy');
t.stdin.setKeyboardProtocol('kitty');
t.setRawMode(false);
t.stdin.pause();

// ── decodeInput: the other direction of CSI ─────────────────────────────────────────────────────────────────────

const decoded = decodeInput('a\x1b[A\x1b[<4;3;2M\x1b[<0;3;2m\x1b[<32;4;2M\x1b[<65;1;1M\x1b[M#!!');
same(decoded.map((i) => i.type), [InputType.KEY_DOWN, InputType.KEY_DOWN, InputType.MOUSE, InputType.MOUSE,
    InputType.MOUSE, InputType.MOUSE, InputType.MOUSE]);
const [plain, up, press, release, drag, wheel, x10] = decoded;
same(plain.type === InputType.KEY_DOWN && [plain.key, plain.code, plain.sequence], ['a', Key.KEY_A, 'a']);
same(up.type === InputType.KEY_DOWN && [up.key, up.code], ['ArrowUp', Key.ARROW_UP]);
same(press.type === InputType.MOUSE && [press.action, press.button, press.x, press.y, press.shiftKey, press.ctrlKey],
    [MouseAction.PRESS, MouseButton.LEFT, 2, 1, true, false], 'Shift+click at column 3, row 2 (0-based 2, 1)');
same(release.type === InputType.MOUSE && [release.action, release.button, release.shiftKey],
    [MouseAction.RELEASE, MouseButton.LEFT, false]);
same(drag.type === InputType.MOUSE && [drag.action, drag.button, drag.x], [MouseAction.DRAG, MouseButton.LEFT, 3]);
same(wheel.type === InputType.MOUSE && [wheel.action, wheel.button, wheel.direction], [MouseAction.SCROLL, null, 1]);
same(x10.type === InputType.MOUSE && [x10.action, x10.button, x10.x, x10.y], [MouseAction.RELEASE, null, 0, 0],
    'an X10 release names no button');
eq(press.sequence, '\x1b[<4;3;2M');

/** A decoded key as `type code key modifiers`, for compact checks. */
function keyOf(input: TtyInput): string {
    if (input.type === InputType.MOUSE) return 'mouse';
    if (input.type === InputType.PASTE) return `paste ${JSON.stringify(input.text)}`;
    let mods = (input.ctrlKey ? 'C' : '') + (input.altKey ? 'A' : '') + (input.shiftKey ? 'S' : '')
        + (input.metaKey ? 'M' : '') + (input.repeat ? 'R' : '');
    return `${input.type} ${input.code} ${JSON.stringify(input.key)}${mods === '' ? '' : ' ' + mods}`;
}

// Legacy input: the physical key is guessed from a US keyboard.
same(decodeInput('A!\x1bx\x03\r\x7f\x1b[1;5C\x1b[3~\x1bOP\x1b[Zé').map(keyOf), [
    'keydown KeyA "A" S', 'keydown Digit1 "!" S', 'keydown KeyX "x" A', 'keydown KeyC "c" C', 'keydown Enter "Enter"',
    'keydown Backspace "Backspace"', 'keydown ArrowRight "ArrowRight" C', 'keydown Delete "Delete"', 'keydown F1 "F1"',
    'keydown Tab "Tab" S', 'keydown Unidentified "é"',
]);
// Kitty keyboard protocol: presses, repeats and releases of every key, with the text it types.
same(decodeInput('\x1b[97;1;97u\x1b[97;2:2;65u\x1b[97;5:3u\x1b[49:33;2;33u\x1b[57399u\x1b[57414;1:3u'
    + '\x1b[57447;2u\x1b[57444;9u\x1b[27u\x1b[1;1:3A\x1b[13~\x1b[57376u\x1b[59;1;228u').map(keyOf), [
    'keydown KeyA "a"', 'keydown KeyA "A" SR', 'keyup KeyA "a" C', 'keydown Digit1 "!" S', 'keydown Numpad0 "0"',
    'keyup NumpadEnter "Enter"', 'keydown ShiftRight "Shift" S', 'keydown MetaLeft "Meta" M', 'keydown Escape "Escape"',
    'keyup ArrowUp "ArrowUp"', 'keydown F3 "F3"', 'keydown F13 "F13"', 'keydown Semicolon "ä"',
]);
// Bracketed paste: one event with the text (escapes in it are not keys); unterminated, it runs to the end.
same(decodeInput('a\x1b[200~x\x1b[Ay\ry\x1b[201~b').map(keyOf),
    ['keydown KeyA "a"', 'paste "x\\u001b[Ay\\ry"', 'keydown KeyB "b"']);
same(decodeInput('\x1b[200~open').map(keyOf), ['paste "open"']);
eq(CSI.bracketedPaste(true), '\x1b[?2004h');
eq(CSI.bracketedPaste(false), '\x1b[?2004l');
eq(CSI.alternateScreen(true), '\x1b[?1049h');
eq(CSI.alternateScreen(false), '\x1b[?1049l');
eq(Object.isFrozen(Key), true);
eq(CSI.pushKeyboardFlags(27), '\x1b[>27u');
eq(CSI.popKeyboardFlags(2), '\x1b[<2u');

// ── Term on a virtual TTY ────────────────────────────────────────────────────────────────────────────────────────

const v = new TTY(5, 3);
const term = new Term(v);
eq(term.tty, v);
same(term.getSize(), { width: 5, height: 3 });

term.write('ab');
eq(v.readOutput(), 'ab', 'default colours: plain text');
same(term.getCursorPos(), { x: 2, y: 0 });

term.write('cdefg');
eq(v.readOutput(), 'cde', 'write cuts off at the width');
same(term.getCursorPos(), { x: 7, y: 0 }, 'the cursor moves past the edge');
term.setCursorPos({ x: 0, y: 0 });
v.readOutput();
term.print('abcdefg');
eq(v.readOutput(), 'abcde\r\nfg\r\n', 'print wraps at the width');
same(term.getCursorPos(), { x: 0, y: 2 });
term.setCursorPos({ x: 2, y: 1 });
v.readOutput();

term.setTextColor(ColorIndex.RED);
term.setBackgroundColor(ColorIndex.BROWN);
term.write('x');
eq(v.readOutput(), '\x1b[38;5;1;48;5;3mx\x1b[0m', 'colors apply to this write only');
eq(term.getTextColor(), 1);
eq(term.getBackgroundColor(), 3);
// @ts-expect-error: not a ColorIndex (TypeScript rejects it; plain JS gets the error).
throws(() => term.setTextColor(16), 'ERR_OUT_OF_RANGE');
const background: ColorIndex = term.getBackgroundColor();
eq(background, ColorIndex.BROWN);
throws(() => term.setTextColor('red' as any), 'ERR_INVALID_ARG_TYPE');
term.setTextColor(ColorIndex.WHITE);
term.setBackgroundColor(ColorIndex.BLACK);
eq(ColorIndex.GREY, ColorIndex.GRAY, 'British spellings');
eq(new Set(Object.values(ColorIndex)).size, 16, 'one index per color');
eq(Object.isFrozen(ColorIndex), true);
eq(CSI.color(15, 0), '\x1b[38;5;15;48;5;0m');
throws(() => CSI.color(16), 'ERR_OUT_OF_RANGE');

// The palette: what an index shows, set with OSC 4 and read back from the device.
term.setPaletteColor(ColorIndex.BLUE, Color.from('#87ceeb'));
term.setPaletteColor(ColorIndex.RED, new Color(255, 0, 0, 0.5));
eq(v.readOutput(), '\x1b]4;4;rgb:87/ce/eb\x1b\\\x1b]4;1;rgb:7f/00/00\x1b\\', 'translucent: taken over black');
term.resetPalette(4);
term.resetPalette();
eq(v.readOutput(), '\x1b]104;4\x1b\\\x1b]104\x1b\\');
eq(term.getPaletteColor(4), undefined, 'a virtual TTY has no device');
// @ts-expect-error: not a ColorIndex.
throws(() => term.setPaletteColor(16, new Color(0, 0, 0)), 'ERR_OUT_OF_RANGE');
throws(() => term.setPaletteColor(1, '#ff0000' as any), 'ERR_INVALID_ARG_TYPE', 'only Colors');
const screenTerm = new Term(); // process.stdout: a console of the screen
eq(String(screenTerm.getPaletteColor(ColorIndex.BLUE)), '#3366cc', 'the default');
screenTerm.setPaletteColor(ColorIndex.BLUE, new Color(1, 2, 3));
eq(String(screenTerm.getPaletteColor(ColorIndex.BLUE)), '#010203');
screenTerm.resetPalette();
eq(String(screenTerm.getPaletteColor(ColorIndex.BLUE)), '#3366cc');

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
eq(term.readKey()!.key, 'q');
eq(term.readKey()!.code, Key.ARROW_DOWN);
eq(term.readChar(), 'z');
// readInput returns mouse events too; readChar skips them.
v.input('\x1b[<2;5;4Mk\x1b[<0;1;1Mw');
const click = term.readInput()!;
same(click.type === InputType.MOUSE && [click.action, click.button, click.x, click.y],
    [MouseAction.PRESS, MouseButton.RIGHT, 4, 3]);
same(term.readInput()!.type, InputType.KEY_DOWN);
eq(term.readChar(), 'w');
v.setRawMode(false);
v.input('first\rsecond\r');
eq(term.readLine(), 'first');
eq(term.readLine(), 'second');

// ── The terminal bell: a BEL in the output emits tty_bell (the OS plays it), not one ending an OSC ─────────────────

const bells: number[] = [];
const bell = (id: number) => bells.push(id);
events.on('tty_bell', bell);
const b = new TTY(5, 2);
b.stdout.write('a\x07b\x07');
b.stdout.write('\x1b]4;1;rgb:ff/00/00\x07');
b.stdout.write('\x1b]104\x1b\\no bell');
b.stderr.write('\x07');
events.off('tty_bell', bell);
same(bells, [b.handle.getId(), b.handle.getId()], 'once per write, from stdout and stderr');
eq(b.readOutput(), 'a\x07b\x07\x1b]4;1;rgb:ff/00/00\x07\x1b]104\x1b\\no bell', 'the BEL is still written');

// ── Term.tabulate / Term.page ───────────────────────────────────────────────────────────────────────────────────────

const tab = new TTY(20, 4);
const tabTerm = new Term(tab);
tabTerm.tabulate(['a', 'bb', 'ccc', 'dddd', 'e'], ColorIndex.LIME, ['x']);
// Columns are max(20 / 8, 4 + 1) = 5 wide: four per row; the lime list starts a new row.
eq(tab.readOutput(), 'a    bb   ccc  dddd\r\ne\r\n' + CSI.color(ColorIndex.LIME, ColorIndex.BLACK) + 'x\r\n' + CSI.reset);
eq(tabTerm.getTextColor(), ColorIndex.WHITE, 'the text color is restored');
prelude.throws(() => tabTerm.tabulate('x' as any), 'ERR_INVALID_ARG_TYPE');

// page: a screen (height - 1 rows) at a time; any key goes on, q stops.
const pager = new TTY(10, 3);
const pagerTerm = new Term(pager);
pager.stdin.setRawMode(true);
pager.input(' ');
eq(pagerTerm.page('one\ntwo\nthree'), true);
let paged = util.stripVTControlCharacters(pager.readOutput() ?? '');
eq(paged.indexOf('one\r\ntwo\r\nPress any ') >= 0, true, paged); // cut off at the width
eq(paged.endsWith('three\r\n'), true, paged);
pager.input('q');
eq(pagerTerm.page('1\n2\n3\n4'), false, 'q stops');
eq(util.stripVTControlCharacters(pager.readOutput() ?? '').indexOf('3') < 0, true, 'nothing after q');
eq(pager.stdin.isRaw, true, 'raw mode stays as it was');
