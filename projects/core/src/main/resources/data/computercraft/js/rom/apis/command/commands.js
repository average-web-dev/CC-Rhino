// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Execute Minecraft commands and gather data from a command computer — mirrors
// the CC Lua commands API. Only available on Command computers.
//
// In Lua the command helpers are generated up-front from `commands.list()`. Here
// we generate them lazily through a Proxy, so `commands.setblock("~", "~1", "~",
// "minecraft:stone")` runs "/setblock ..." and nested subcommands work too. Real
// native methods (exec, execAsync, list, getBlockInfo, ...) pass straight
// through; the async helpers live under `commands.async`.

if (typeof commands === "undefined" || !commands) {
    throw new Error("Cannot load command API on normal computer");
}

// The builtin commands API, without any generated helper functions.
const native = commands.native ?? commands;

// These commands take plain JSON rather than the NBT-flavoured JSON variant.
const NON_NBT = new Set(["tellraw", "title"]);

function collapseArgs(_jsonIsNBT, ...args) {
    return args.map((arg) => {
        const t = type(arg);
        if (t === "boolean" || t === "number" || t === "string") return tostring(arg);
        if (t === "table") return JSON.stringify(arg);
        throw new Error("Expected string, number, boolean or table");
    }).join(" ");
}

// Build a callable command (and a Proxy so child sub-commands resolve lazily).
function mkCommand(nameParts, jsonIsNBT, func) {
    const fn = (...args) => func(collapseArgs(jsonIsNBT, nameParts.join(" "), ...args));
    fn.toString = () => `command "/${nameParts.join(" ")}"`;
    return new Proxy(fn, {
        get(target, key) {
            if (typeof key !== "string" || key in target) return target[key];
            return mkCommand([...nameParts, key], jsonIsNBT, func);
        },
    });
}

// commands.async.<name>(...) — asynchronous wrappers returning the task id.
const async = new Proxy({}, {
    get(_t, key) {
        if (typeof key !== "string") return undefined;
        return mkCommand([key], !NON_NBT.has(key), native.execAsync);
    },
});

const base = { native, async };

export default new Proxy(base, {
    get(target, key) {
        if (typeof key !== "string" || key in target) return target[key];
        const nativeMember = native[key];
        if (typeof nativeMember === "function") return nativeMember; // real native method
        return mkCommand([key], !NON_NBT.has(key), native.exec);
    },
});
