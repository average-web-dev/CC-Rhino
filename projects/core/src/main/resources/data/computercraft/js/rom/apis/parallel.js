// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// A simple way to run several functions at once — mirrors the CC Lua parallel API.
//
// In the Lua implementation each function is a coroutine that yields on events,
// and parallel switches between them by hand. The JS runtime is already
// cooperatively scheduled through the async event loop: the async APIs
// (os.sleep, rednet.receive, event waits built on os.on/once, ...) return
// Promises, so an `async` function naturally "pauses" on `await` and lets the
// others run. We therefore
// model each parallel function as an async function and compose their Promises.
//
// WARNING (same as Lua): pass the functions themselves, not the result of
// calling them — e.g. waitForAny(doSleep, rednetReceive), not
// waitForAny(doSleep(), rednetReceive).

function expectFunction(i, fn) {
    if (typeof fn !== "function") {
        throw new Error(`bad argument #${i} (function expected, got ${type(fn)})`);
    }
}

// Switches between execution of the functions until any of them finishes. If a
// function errors, the error is propagated out of the waitForAny call. Returns
// the 1-based index of the function that finished first.
async function waitForAny(...fns) {
    fns.forEach((fn, i) => expectFunction(i + 1, fn));
    if (fns.length < 1) return 0;

    return Promise.race(fns.map((fn, i) => (async () => {
        await fn();
        return i + 1;
    })()));
}

// Runs several functions in parallel until all of them are finished. If any
// errors, the error is propagated upwards (the remaining functions keep their
// own pending awaits but their results are ignored).
//
// Each function is passed a `spawn(fn, ...args)` callback which starts a new
// parallel function from within the waitForAll call.
async function waitForAll(...fns) {
    fns.forEach((fn, i) => expectFunction(i + 1, fn));

    const pending = new Set();
    let canSpawn = true;

    function spawn(fn, ...args) {
        expectFunction(1, fn);
        if (!canSpawn) throw new Error("Cannot spawn new functions outside of waitForAll");

        const p = (async () => fn(...args))();
        pending.add(p);
        // Remove from the pending set once settled so the loop below can drain.
        p.then(() => pending.delete(p), () => pending.delete(p));
    }

    for (const fn of fns) spawn(fn, spawn);

    try {
        // Drain until no functions remain. Promise.race re-arms each time a
        // function settles, picking up anything spawned in the meantime.
        while (pending.size > 0) await Promise.race(pending);
    } finally {
        canSpawn = false;
    }
}

export default { waitForAny, waitForAll };
