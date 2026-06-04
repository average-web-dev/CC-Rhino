// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Read and write configuration options for CraftOS and your programs — mirrors
// the CC Lua settings API. Values are read from /.settings at boot and may be
// read via settings.get or modified via settings.set/unset. Modifications queue
// a setting_changed event. settings.set does NOT persist by default — call
// settings.save.

import textutils from "/rom/apis/textutils.js";

const details = {};
const values = {};

const validTypes = ["number", "string", "boolean", "table"];

// In Lua "table" covers arrays and objects; map it onto JS for type checks.
function luaType(value) {
    return type(value);
}

function reserialize(value) {
    if (luaType(value) !== "table") return value;
    return textutils.unserialize(textutils.serialize(value));
}

function copy(value) {
    if (value === null || value === undefined) return value;
    if (luaType(value) !== "table") return value;
    if (Array.isArray(value)) return value.map(copy);
    const result = {};
    for (const k of Object.keys(value)) result[k] = copy(value[k]);
    return result;
}

function expectString(i, name) {
    if (typeof name !== "string") {
        throw new Error(`bad argument #${i} (string expected, got ${type(name)})`);
    }
}

// Define a new setting, optionally specifying { description, default, type }.
function define(name, options) {
    expectString(1, name);

    if (options) {
        const def = reserialize(options.default);
        const opt = {
            description: options.description,
            default: def,
            type: options.type,
        };
        if (opt.type !== undefined && opt.type !== null && !validTypes.includes(opt.type)) {
            throw new Error(`Unknown type "${opt.type}". Expected one of ${validTypes.join(", ")}.`);
        }
        details[name] = opt;
    } else {
        details[name] = {};
    }
}

// Remove a definition of a setting. Does not remove its value (use unset).
function undefine(name) {
    expectString(1, name);
    delete details[name];
}

function setValue(name, newValue) {
    let old = values[name];
    if (old === undefined) {
        const opt = details[name];
        old = opt ? opt.default : undefined;
    }

    if (newValue === undefined) delete values[name];
    else values[name] = newValue;

    if (old !== newValue) os.queueEvent("setting_changed", name, newValue, old);
}

// Set the value of a setting. Does NOT persist — call save().
function set(name, value) {
    expectString(1, name);
    if (value === undefined || value === null) {
        throw new Error("bad argument #2 (value cannot be nil)");
    }

    const opt = details[name];
    if (opt && opt.type && luaType(value) !== opt.type) {
        throw new Error(`bad argument #2 (${opt.type} expected, got ${type(value)})`);
    }

    setValue(name, reserialize(value));
}

// Get the value of a setting, falling back to `default`, then the defined default.
function get(name, defaultValue) {
    expectString(1, name);
    const result = values[name];
    if (result !== undefined) return copy(result);
    if (defaultValue !== undefined) return defaultValue;
    const opt = details[name];
    return opt ? copy(opt.default) : undefined;
}

// Get details about a specific setting, including its current value.
function getDetails(name) {
    expectString(1, name);
    const deets = copy(details[name]) || {};
    deets.value = values[name];
    deets.changed = deets.value !== undefined;
    if (deets.value === undefined) deets.value = deets.default;
    return deets;
}

// Remove the value of a setting, resetting it to its default.
function unset(name) {
    expectString(1, name);
    setValue(name, undefined);
}

// Reset the value of all settings.
function clear() {
    for (const name of Object.keys(values)) setValue(name, undefined);
}

// Get an alphabetically sorted list of all currently-defined settings.
function getNames() {
    const seen = new Set();
    for (const k of Object.keys(details)) seen.add(k);
    for (const k of Object.keys(values)) seen.add(k);
    return [...seen].sort();
}

// Load settings from the given file (default ".settings"), merging with existing.
function load(path) {
    if (path !== undefined && path !== null) expectString(1, path);
    const file = fs.open(path ?? ".settings", "r");
    if (!file) return false;

    const text = file.readAll();
    file.close();

    const parsed = textutils.unserialize(text);
    if (luaType(parsed) !== "table") return false;

    for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        const tyV = luaType(v);
        if (tyV === "string" || tyV === "number" || tyV === "boolean" || tyV === "table") {
            const opt = details[k];
            if (!opt || !opt.type || tyV === opt.type) {
                try {
                    setValue(k, reserialize(v));
                } catch (_) {
                    // Skip values that cannot be serialized.
                }
            }
        }
    }

    return true;
}

// Save settings to the given file (default ".settings"), overwriting it entirely.
function save(path) {
    if (path !== undefined && path !== null) expectString(1, path);
    const file = fs.open(path ?? ".settings", "w");
    if (!file) return false;

    file.write(textutils.serialize(values));
    file.close();

    return true;
}

export default {
    define, undefine, set, get, getDetails, unset, clear, getNames, load, save,
};
