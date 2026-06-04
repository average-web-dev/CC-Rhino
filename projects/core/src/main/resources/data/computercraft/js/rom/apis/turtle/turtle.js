// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Turtle control — mirrors the CC Lua turtle API. This augments the native
// turtle global with a `craft` method (present only when a crafting table
// upgrade is equipped), and refreshes it whenever a tool is equipped.
//
// Native turtle methods (forward, dig, ...) pass straight through via a Proxy.
// peripheral.getType is synchronous, so detecting the workbench needs no await;
// peripheral.call (used by craft) yields and returns a Promise the caller awaits.

if (typeof turtle === "undefined" || !turtle) {
    throw new Error("Cannot load turtle API on computer");
}

// The builtin turtle API, without any generated helper functions.
const native = turtle.native ?? turtle;

const peripheralNative = peripheral;

function firstType(side) {
    const t = peripheralNative.getType(side);
    return Array.isArray(t) ? t[0] : t;
}

// (Re)attach a craft method if a crafting table upgrade is equipped.
function addCraftMethod(object) {
    if (firstType("left") === "workbench") {
        object.craft = (...args) => peripheralNative.call("left", "craft", ...args);
    } else if (firstType("right") === "workbench") {
        object.craft = (...args) => peripheralNative.call("right", "craft", ...args);
    } else {
        delete object.craft;
    }
}

const base = { native };

base.equipLeft = async (...args) => {
    const result = await native.equipLeft(...args);
    addCraftMethod(base);
    return result;
};

base.equipRight = async (...args) => {
    const result = await native.equipRight(...args);
    addCraftMethod(base);
    return result;
};

addCraftMethod(base);

export default new Proxy(base, {
    get(target, key) {
        if (typeof key !== "string" || key in target) return target[key];
        return native[key];
    },
});
