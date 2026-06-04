// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Find and control peripherals attached to this computer — mirrors the CC Lua
// peripheral API. This wraps the native `peripheral` global (provided by the
// host) with support for wired-modem peripheral hubs, wrapping, and finding.
//
// Note on async: peripheral.call yields in CC, so the native call returns a
// Promise here. The functions below `await` it, which means call/wrap/find and
// the wrapped methods are async and must be awaited by callers.
//
// Note on multiple return values: Lua's getType and find return several values
// at once. JavaScript cannot, so getType returns an array of type strings and
// find returns an array of wrapped peripherals.

const native = peripheral;
const sides = rs.getSides();

// Non-enumerable marker holding a wrapped peripheral's metadata.
const META = "__peripheral";

function isWrapped(p) {
    return p !== null && typeof p === "object" && p[META] && p[META].name !== undefined;
}

function expectString(i, v) {
    if (typeof v !== "string") throw new Error(`bad argument #${i} (string expected, got ${type(v)})`);
}

function toArray(v) {
    if (v === null || v === undefined) return [];
    return Array.isArray(v) ? v : [v];
}

// Provides a list of the names of all attached peripherals (sides and names
// reported by wired-modem peripheral hubs).
async function getNames() {
    const results = [];
    for (const side of sides) {
        if (native.isPresent(side)) {
            results.push(side);
            if (native.hasType(side, "peripheral_hub")) {
                const remote = await native.call(side, "getNamesRemote");
                for (const name of remote) results.push(name);
            }
        }
    }
    return results;
}

// Determines if a peripheral is present with the given name.
async function isPresent(name) {
    expectString(1, name);
    if (native.isPresent(name)) return true;

    for (const side of sides) {
        if (native.hasType(side, "peripheral_hub") && await native.call(side, "isPresentRemote", name)) {
            return true;
        }
    }
    return false;
}

// Get the types of a named or wrapped peripheral, as an array, or null if the
// named peripheral is not present.
async function getType(p) {
    if (typeof p === "string") {
        if (native.isPresent(p)) return toArray(native.getType(p));
        for (const side of sides) {
            if (native.hasType(side, "peripheral_hub") && await native.call(side, "isPresentRemote", p)) {
                return toArray(await native.call(side, "getTypeRemote", p));
            }
        }
        return null;
    }
    if (!isWrapped(p)) throw new Error("bad argument #1 (table is not a peripheral)");
    return p[META].types.slice();
}

// Check if a peripheral is of a particular type, or null if not present.
async function hasType(p, peripheralType) {
    expectString(2, peripheralType);
    if (typeof p === "string") {
        if (native.isPresent(p)) return native.hasType(p, peripheralType);
        for (const side of sides) {
            if (native.hasType(side, "peripheral_hub") && await native.call(side, "isPresentRemote", p)) {
                return await native.call(side, "hasTypeRemote", p, peripheralType);
            }
        }
        return null;
    }
    if (!isWrapped(p)) throw new Error("bad argument #1 (table is not a peripheral)");
    return p[META].types.includes(peripheralType);
}

// Get all available methods for the peripheral with the given name, or null.
async function getMethods(name) {
    expectString(1, name);
    if (native.isPresent(name)) return native.getMethods(name);
    for (const side of sides) {
        if (native.hasType(side, "peripheral_hub") && await native.call(side, "isPresentRemote", name)) {
            return await native.call(side, "getMethodsRemote", name);
        }
    }
    return null;
}

// Get the name of a peripheral wrapped with wrap().
function getName(p) {
    if (!isWrapped(p)) throw new Error("bad argument #1 (table is not a peripheral)");
    return p[META].name;
}

// Call a method on the peripheral with the given name.
async function call(name, method, ...args) {
    expectString(1, name);
    expectString(2, method);
    if (native.isPresent(name)) return native.call(name, method, ...args);

    for (const side of sides) {
        if (native.hasType(side, "peripheral_hub") && await native.call(side, "isPresentRemote", name)) {
            return native.call(side, "callRemote", name, method, ...args);
        }
    }
    return null;
}

// Get an object containing all functions available on a peripheral, or null.
async function wrap(name) {
    expectString(1, name);

    const methods = await getMethods(name);
    if (!methods) return null;

    const types = toArray(await getType(name));
    const result = {};
    Object.defineProperty(result, META, {
        value: { name, type: types[0], types },
        enumerable: false,
    });
    for (const method of methods) {
        result[method] = (...args) => call(name, method, ...args);
    }
    return result;
}

// Find all peripherals of a specific type and return the wrapped peripherals as
// an array. An optional filter(name, wrapped) decides whether each is included.
async function find(ty, filter) {
    expectString(1, ty);
    const results = [];
    for (const name of await getNames()) {
        if (await hasType(name, ty)) {
            const wrapped = await wrap(name);
            if (filter === undefined || filter === null || await filter(name, wrapped)) {
                results.push(wrapped);
            }
        }
    }
    return results;
}

export default {
    getNames, isPresent, getType, hasType, getMethods, getName, call, wrap, find,
};
