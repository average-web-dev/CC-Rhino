// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Terminal output with redirect support — mirrors the CC Lua term API. This
// wraps the native `term` global so output can be redirected to a monitor, a
// window, or any other terminal object (a table with the same method names).

const native = (typeof term !== "undefined" && term.native) ? term.native() : term;
let redirectTarget = native;

// The standard Redirect interface methods routed through the current target.
// (Listed explicitly rather than enumerating the native proxy.)
const REDIRECT_METHODS = [
    "write", "scroll", "blit",
    "getCursorPos", "setCursorPos",
    "getCursorBlink", "setCursorBlink",
    "getSize", "clear", "clearLine",
    "getTextColour", "getTextColor", "setTextColour", "setTextColor",
    "getBackgroundColour", "getBackgroundColor", "setBackgroundColour", "setBackgroundColor",
    "isColour", "isColor",
    "getPaletteColour", "getPaletteColor", "setPaletteColour", "setPaletteColor",
];

const api = {};

// Redirect terminal output to the given target, returning the previous target.
api.redirect = (target) => {
    if (target === null || typeof target !== "object") {
        throw new Error(`bad argument #1 (table expected, got ${type(target)})`);
    }
    if (target === api || target === native || target === term) {
        throw new Error("term is not a recommended redirect target, try term.current() instead");
    }
    // Fill in any missing methods with a helpful error.
    for (const k of REDIRECT_METHODS) {
        if (typeof target[k] !== "function" && typeof native[k] === "function") {
            target[k] = () => { throw new Error(`Redirect object is missing method ${k}.`); };
        }
    }
    const old = redirectTarget;
    redirectTarget = target;
    return old;
};

// Returns the current terminal redirect target.
api.current = () => redirectTarget;

// Returns the native terminal object. Avoid using this in multitasked programs.
api.native = () => native;

// These methods bypass redirects and operate on the native terminal directly.
api.nativePaletteColour = (...args) => native.nativePaletteColour(...args);
api.nativePaletteColor = (...args) =>
    (native.nativePaletteColor ?? native.nativePaletteColour)(...args);

for (const method of REDIRECT_METHODS) {
    api[method] = (...args) => redirectTarget[method](...args);
}

export default api;
