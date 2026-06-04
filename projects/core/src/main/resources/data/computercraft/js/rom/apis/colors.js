// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

// Color constants and utilities — mirrors the CC Lua colors API.
const colors = {
    white:     0x1,
    orange:    0x2,
    magenta:   0x4,
    lightBlue: 0x8,
    yellow:    0x10,
    lime:      0x20,
    pink:      0x40,
    gray:      0x80,
    lightGray: 0x100,
    cyan:      0x200,
    purple:    0x400,
    blue:      0x800,
    brown:     0x1000,
    green:     0x2000,
    red:       0x4000,
    black:     0x8000,

    combine(...cs) { return cs.reduce((a, b) => (a | b) >>> 0, 0); },
    subtract(c, ...cs) { return cs.reduce((a, b) => (a & ~b) >>> 0, c); },
    test(cs, c) { return (cs & c) === c; },

    packRGB(r, g, b) {
        return ((Math.round(r * 255) & 0xFF) << 16) |
               ((Math.round(g * 255) & 0xFF) << 8)  |
                (Math.round(b * 255) & 0xFF);
    },
    unpackRGB(rgb) {
        return [(rgb >> 16 & 0xFF) / 255, (rgb >> 8 & 0xFF) / 255, (rgb & 0xFF) / 255];
    },

    toBlit(c) {
        if (c < 1 || c > 0x8000) throw new Error("Colour out of range");
        return Math.round(Math.log2(c)).toString(16);
    },
    fromBlit(h) {
        const v = parseInt(h, 16);
        return isNaN(v) ? null : 1 << v;
    },
};

export default colors;
