// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Node-style timers (#45): the globals, require('timers') and require('timers/promises'), on a real computer whose
// clock advances one game tick (50 ms) at a time. Run by StdioLibraryTest.

import prelude = require('./prelude');

const eq = prelude.eq, throws = prelude.throws;
const asyncMod = require('async');
const system = require('system');
const parallel = require('parallel');
const timers = require('timers');
const tp = require('timers/promises');

/** The computer's clock, in ticks. */
function ticks(): number { return Math.round(system.clock() * 20); }

function wait<T>(promise: Promise<T>): T { return asyncMod.unwrap(promise) as T; }

// The globals, require('timers') and require('node:timers') are the same functions.
eq(require('node:timers'), timers);
eq(timers.setTimeout, setTimeout);
eq(timers.clearTimeout, clearTimeout);
eq(timers.setInterval, setInterval);
eq(timers.clearInterval, clearInterval);
eq(timers.setImmediate, setImmediate);
eq(timers.clearImmediate, clearImmediate);
eq(require('node:timers/promises'), tp);
eq(timers.promises, tp);
eq(typeof queueMicrotask, 'function');
eq(Object.keys(globalThis).indexOf('setTimeout'), -1, 'globals are not enumerable');

throws(function () { setTimeout(null as any, 1); }, 'ERR_INVALID_ARG_TYPE');
throws(function () { setInterval('code' as any, 1); }, 'ERR_INVALID_ARG_TYPE');
throws(function () { setImmediate(undefined as any); }, 'ERR_INVALID_ARG_TYPE');

// Order: by due tick (ms rounded up to whole ticks, at least one), then by creation.
let log: string[] = [];
setTimeout(function () { log.push('b100'); }, 100);
setTimeout(function () { log.push('a50'); }, 50);
setTimeout(function () { log.push('c1'); }, 1);
setTimeout(function () { log.push('d0'); }, 0);
setTimeout(function () { log.push('e51'); }, 51);
setTimeout(function () { log.push('fNaN'); }, NaN);
eq(log.length, 0, 'timers never run synchronously');
// Only check the final order: on a slow machine several ticks can pass before this thread resumes, so the
// two-tick timers may already have fired after the first wait.
wait(tp.setTimeout(150));
eq(log.join(), 'a50,c1,d0,fNaN,b100,e51');

// Timing in ticks: 500 ms = 10 ticks; setTimeout(r, 0) still waits for the next tick.
let t0 = ticks();
wait(tp.setTimeout(500));
let elapsed = ticks() - t0;
// Generous upper bound: a slow machine may resume this thread a few ticks late.
assert(elapsed >= 10 && elapsed <= 20, '500 ms took ' + elapsed + ' ticks');
t0 = ticks();
wait(new Promise<void>(function (resolve) { setTimeout(resolve, 0); }));
assert(ticks() - t0 >= 1, 'setTimeout(r, 0) waits a tick');

// Extra arguments, `this` and the Timeout object.
let got: unknown[] = [];
let tm: Timeout = setTimeout(function (this: Timeout, a: number, b: string) { got = [this === tm, a, b]; }, 1, 7, 'x');
eq(tm.hasRef(), true);
eq(tm.unref(), tm);
eq(tm.hasRef(), false);
eq(tm.ref().hasRef(), true);
eq(typeof Number(tm), 'number');
eq(+tm, Number(tm));
wait(tp.setTimeout(100));
eq(got.join(), 'true,7,x');

// clearTimeout: by object, numeric id, string id, close(); bad values are ignored.
let fired: string[] = [];
let c1 = setTimeout(function () { fired.push('c1'); }, 1);
let c2 = setTimeout(function () { fired.push('c2'); }, 1);
let c3 = setTimeout(function () { fired.push('c3'); }, 1);
let c4 = setTimeout(function () { fired.push('c4'); }, 1);
setTimeout(function () { fired.push('kept'); }, 1);
clearTimeout(c1);
clearTimeout(Number(c2));
clearTimeout(String(+c3));
eq(c4.close(), c4);
clearTimeout(undefined);
clearTimeout(null);
clearTimeout(-5);
wait(tp.setTimeout(100));
eq(fired.join(), 'kept');

// Intervals, cleared from inside their own callback; a timeout cleared by an earlier one of the same tick.
let n = 0;
let ticksSeen: number[] = [];
let iv = setInterval(function (step: number) {
    n += step;
    ticksSeen.push(ticks());
    if (n === 3) clearInterval(iv);
}, 50, 1);
let victim: Timeout | undefined;
setTimeout(function () { clearTimeout(victim); }, 100);
victim = setTimeout(function () { fired.push('victim'); }, 100);
wait(tp.setTimeout(400));
eq(n, 3);
eq(ticksSeen[1] - ticksSeen[0], 1, 'an interval re-arms every tick');
eq(fired.join(), 'kept');

// refresh() restarts the countdown, and re-arms a timeout that has already fired.
let refreshed = 0;
let rt = setTimeout(function () { refreshed++; }, 150);
setTimeout(function () { rt.refresh(); }, 100);
wait(tp.setTimeout(200));
eq(refreshed, 0, 'refreshed before it fired');
wait(tp.setTimeout(100));
eq(refreshed, 1);
rt.refresh();
wait(tp.setTimeout(200));
eq(refreshed, 2, 'refresh() after firing re-arms it');

// Callbacks may block.
let blocked = '';
setTimeout(function () { blocked = 'start'; system.sleep(2); blocked = 'done'; }, 1);
wait(tp.setTimeout(50));
eq(blocked, 'start');
wait(tp.setTimeout(150));
eq(blocked, 'done');

// Immediates and microtasks: microtasks first, then immediates (this tick), then timers (next tick).
let order: string[] = [];
setTimeout(function () { order.push('timeout'); }, 0);
let imm = setImmediate(function (this: Immediate, a: string) { order.push('immediate ' + a + ' ' + (this === imm)); }, 'x');
let cancelled = setImmediate(function () { order.push('cancelled'); });
clearImmediate(cancelled);
queueMicrotask(function () { order.push('microtask'); });
Promise.resolve().then(function () { order.push('then'); });
eq(imm.hasRef(), true);
eq(imm.unref().hasRef(), false);
wait(tp.setTimeout(100));
eq(order.join(), 'microtask,then,immediate x true,timeout');

// A stopped thread's timers never fire.
let fromStopped = false;
let child = parallel.spawn(function () {
    setTimeout(function () { fromStopped = true; }, 50);
    setInterval(function () { fromStopped = true; }, 50);
    system.sleep(100);
});
wait(tp.setImmediate());
child.stop();
wait(tp.setTimeout(200));
eq(fromStopped, false);

// Many timers.
let count = 0;
for (let i = 0; i < 2000; i++) setTimeout(function () { count++; }, (i % 5) * 50);
wait(tp.setTimeout(300));
eq(count, 2000);

// timers/promises.
eq(wait(tp.setTimeout(50, 'value')), 'value');
eq(wait(tp.setTimeout(50, 'unref', { ref: false })), 'unref');
eq(wait(tp.setImmediate('now')), 'now');
eq(wait(tp.scheduler.wait(50)), undefined);
eq(wait(tp.scheduler.yield()), undefined);
let rejected = '';
tp.setTimeout(1, 1, 5 as any).then(undefined, function (e: { code?: string }) { rejected = e.code ?? ''; });
wait(tp.setImmediate());
eq(rejected, 'ERR_INVALID_ARG_TYPE');

async function intervals(): Promise<string> {
    let seen: string[] = [];
    let start = ticks();
    for await (let v of tp.setInterval(100, 'x')) {
        seen.push(v);
        if (seen.length === 3) break;
    }
    // 3 × 100 ms = 6 ticks
    let took = ticks() - start;
    assert(took >= 6 && took <= 8, 'three intervals took ' + took + ' ticks');
    return seen.join();
}
eq(wait(intervals()), 'x,x,x');

// Values that fire while nobody waits are queued; return() ends the iteration.
let it = tp.setInterval(50, 'q');
wait(tp.setTimeout(160));
eq(wait(it.next()).value, 'q');
eq(wait(it.next()).value, 'q');
eq(wait(it.return!()).done, true);
eq(wait(it.next()).done, true);
