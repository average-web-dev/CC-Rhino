// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// A terminal redirect occupying a smaller area of an existing terminal — mirrors
// the CC Lua window API. Windows buffer everything drawn through them, so they
// can be redrawn, repositioned, resized, or hidden.
//
// Multiple-return methods (getCursorPos, getSize, getPosition, getPaletteColour,
// getLine) return arrays, matching the native term convention in this runtime.

import colors from "/rom/apis/colors.js";
import colours from "/rom/apis/colours.js";

const tHex = {
    [colors.white]: "0", [colors.orange]: "1", [colors.magenta]: "2", [colors.lightBlue]: "3",
    [colors.yellow]: "4", [colors.lime]: "5", [colors.pink]: "6", [colors.gray]: "7",
    [colors.lightGray]: "8", [colors.cyan]: "9", [colors.purple]: "a", [colors.blue]: "b",
    [colors.brown]: "c", [colors.green]: "d", [colors.red]: "e", [colors.black]: "f",
};

// Lua-style string.sub: 1-based, inclusive, with negative indices from the end.
function luaSub(s, i, j) {
    const len = s.length;
    if (i === undefined) i = 1;
    if (j === undefined || j === null) j = -1;
    if (i < 0) i = Math.max(len + i + 1, 1);
    else if (i === 0) i = 1;
    if (j < 0) j = len + j + 1;
    else if (j > len) j = len;
    if (i > j) return "";
    return s.slice(i - 1, j);
}

function expectNumber(i, v) {
    if (typeof v !== "number") throw new Error(`bad argument #${i} (number expected, got ${type(v)})`);
}
function expectBoolean(i, v) {
    if (typeof v !== "boolean") throw new Error(`bad argument #${i} (boolean expected, got ${type(v)})`);
}
function expectString(i, v) {
    if (typeof v !== "string") throw new Error(`bad argument #${i} (string expected, got ${type(v)})`);
}

// A colors.toBlit specialised for the window API.
function parseColor(color) {
    if (typeof color !== "number") expectNumber(1, color);
    if (color < 1 || color > 0xffff) throw new Error("Colour out of range");
    return 2 ** Math.floor(Math.log2(color));
}

// Returns a terminal object that is a space within the parent terminal.
function create(parent, nX, nY, nWidth, nHeight, bStartVisible) {
    if (parent === null || typeof parent !== "object") {
        throw new Error(`bad argument #1 (table expected, got ${type(parent)})`);
    }
    expectNumber(2, nX);
    expectNumber(3, nY);
    expectNumber(4, nWidth);
    expectNumber(5, nHeight);
    if (parent === term) {
        throw new Error("term is not a recommended window parent, try term.current() instead");
    }

    let sEmptySpaceLine;
    const tEmptyColorLines = {};
    function createEmptyLines(width) {
        sEmptySpaceLine = " ".repeat(width);
        for (let n = 0; n <= 15; n++) {
            const nColor = 2 ** n;
            tEmptyColorLines[nColor] = tHex[nColor].repeat(width);
        }
    }
    createEmptyLines(nWidth);

    let bVisible = bStartVisible !== false;
    let nCursorX = 1;
    let nCursorY = 1;
    let bCursorBlink = false;
    let nTextColor = colors.white;
    let nBackgroundColor = colors.black;
    let tLines = [];
    const tPalette = {};
    {
        for (let y = 1; y <= nHeight; y++) {
            tLines[y] = [sEmptySpaceLine, tEmptyColorLines[nTextColor], tEmptyColorLines[nBackgroundColor]];
        }
        for (let i = 0; i <= 15; i++) {
            const c = 2 ** i;
            tPalette[c] = parent.getPaletteColour(c); // [r, g, b]
        }
    }

    function updateCursorPos() {
        if (nCursorX >= 1 && nCursorY >= 1 && nCursorX <= nWidth && nCursorY <= nHeight) {
            parent.setCursorPos(nX + nCursorX - 1, nY + nCursorY - 1);
        } else {
            parent.setCursorPos(0, 0);
        }
    }
    function updateCursorBlink() { parent.setCursorBlink(bCursorBlink); }
    function updateCursorColor() { parent.setTextColor(nTextColor); }

    function redrawLine(n) {
        const tLine = tLines[n];
        parent.setCursorPos(nX, nY + n - 1);
        parent.blit(tLine[0], tLine[1], tLine[2]);
    }
    function redraw() {
        for (let n = 1; n <= nHeight; n++) redrawLine(n);
    }
    function updatePalette() {
        for (const k of Object.keys(tPalette)) {
            const v = tPalette[k];
            parent.setPaletteColour(Number(k), v[0], v[1], v[2]);
        }
    }

    function internalBlit(sText, sTextColor, sBackgroundColor) {
        const nStart = nCursorX;
        const nEnd = nStart + sText.length - 1;
        if (nCursorY >= 1 && nCursorY <= nHeight) {
            if (nStart <= nWidth && nEnd >= 1) {
                const tLine = tLines[nCursorY];
                if (nStart === 1 && nEnd === nWidth) {
                    tLine[0] = sText;
                    tLine[1] = sTextColor;
                    tLine[2] = sBackgroundColor;
                } else {
                    let sClippedText, sClippedTextColor, sClippedBackgroundColor;
                    if (nStart < 1) {
                        const nClipStart = 1 - nStart + 1;
                        const nClipEnd = nWidth - nStart + 1;
                        sClippedText = luaSub(sText, nClipStart, nClipEnd);
                        sClippedTextColor = luaSub(sTextColor, nClipStart, nClipEnd);
                        sClippedBackgroundColor = luaSub(sBackgroundColor, nClipStart, nClipEnd);
                    } else if (nEnd > nWidth) {
                        const nClipEnd = nWidth - nStart + 1;
                        sClippedText = luaSub(sText, 1, nClipEnd);
                        sClippedTextColor = luaSub(sTextColor, 1, nClipEnd);
                        sClippedBackgroundColor = luaSub(sBackgroundColor, 1, nClipEnd);
                    } else {
                        sClippedText = sText;
                        sClippedTextColor = sTextColor;
                        sClippedBackgroundColor = sBackgroundColor;
                    }

                    const sOldText = tLine[0];
                    const sOldTextColor = tLine[1];
                    const sOldBackgroundColor = tLine[2];
                    let sNewText, sNewTextColor, sNewBackgroundColor;
                    if (nStart > 1) {
                        const nOldEnd = nStart - 1;
                        sNewText = luaSub(sOldText, 1, nOldEnd) + sClippedText;
                        sNewTextColor = luaSub(sOldTextColor, 1, nOldEnd) + sClippedTextColor;
                        sNewBackgroundColor = luaSub(sOldBackgroundColor, 1, nOldEnd) + sClippedBackgroundColor;
                    } else {
                        sNewText = sClippedText;
                        sNewTextColor = sClippedTextColor;
                        sNewBackgroundColor = sClippedBackgroundColor;
                    }
                    if (nEnd < nWidth) {
                        const nOldStart = nEnd + 1;
                        sNewText += luaSub(sOldText, nOldStart, nWidth);
                        sNewTextColor += luaSub(sOldTextColor, nOldStart, nWidth);
                        sNewBackgroundColor += luaSub(sOldBackgroundColor, nOldStart, nWidth);
                    }

                    tLine[0] = sNewText;
                    tLine[1] = sNewTextColor;
                    tLine[2] = sNewBackgroundColor;
                }

                if (bVisible) redrawLine(nCursorY);
            }
        }

        nCursorX = nEnd + 1;
        if (bVisible) {
            updateCursorColor();
            updateCursorPos();
        }
    }

    const window = {};

    window.write = (sText) => {
        sText = tostring(sText);
        internalBlit(sText, tHex[nTextColor].repeat(sText.length), tHex[nBackgroundColor].repeat(sText.length));
    };

    window.blit = (sText, sTextColor, sBackgroundColor) => {
        expectString(1, sText);
        expectString(2, sTextColor);
        expectString(3, sBackgroundColor);
        if (sTextColor.length !== sText.length || sBackgroundColor.length !== sText.length) {
            throw new Error("Arguments must be the same length");
        }
        internalBlit(sText, sTextColor.toLowerCase(), sBackgroundColor.toLowerCase());
    };

    window.clear = () => {
        const t = sEmptySpaceLine, fg = tEmptyColorLines[nTextColor], bg = tEmptyColorLines[nBackgroundColor];
        for (let y = 1; y <= nHeight; y++) {
            tLines[y][0] = t;
            tLines[y][1] = fg;
            tLines[y][2] = bg;
        }
        if (bVisible) {
            redraw();
            updateCursorColor();
            updateCursorPos();
        }
    };

    window.clearLine = () => {
        if (nCursorY >= 1 && nCursorY <= nHeight) {
            const line = tLines[nCursorY];
            line[0] = sEmptySpaceLine;
            line[1] = tEmptyColorLines[nTextColor];
            line[2] = tEmptyColorLines[nBackgroundColor];
            if (bVisible) {
                redrawLine(nCursorY);
                updateCursorColor();
                updateCursorPos();
            }
        }
    };

    window.getCursorPos = () => [nCursorX, nCursorY];

    window.setCursorPos = (x, y) => {
        expectNumber(1, x);
        expectNumber(2, y);
        nCursorX = Math.floor(x);
        nCursorY = Math.floor(y);
        if (bVisible) updateCursorPos();
    };

    window.setCursorBlink = (blink) => {
        expectBoolean(1, blink);
        bCursorBlink = blink;
        if (bVisible) updateCursorBlink();
    };

    window.getCursorBlink = () => bCursorBlink;

    const isColor = () => parent.isColor();
    window.isColor = isColor;
    window.isColour = isColor;

    const setTextColor = (color) => {
        if (tHex[color] === undefined) color = parseColor(color);
        nTextColor = color;
        if (bVisible) updateCursorColor();
    };
    window.setTextColor = setTextColor;
    window.setTextColour = setTextColor;

    window.setPaletteColour = (colour, r, g, b) => {
        if (tHex[colour] === undefined) colour = parseColor(colour);
        let tCol;
        if (typeof r === "number" && g === undefined && b === undefined) {
            tCol = colours.unpackRGB(r);
            tPalette[colour] = tCol;
        } else {
            expectNumber(2, r);
            expectNumber(3, g);
            expectNumber(4, b);
            tCol = tPalette[colour];
            tCol[0] = r;
            tCol[1] = g;
            tCol[2] = b;
        }
        if (bVisible) return parent.setPaletteColour(colour, tCol[0], tCol[1], tCol[2]);
    };
    window.setPaletteColor = window.setPaletteColour;

    window.getPaletteColour = (colour) => {
        if (tHex[colour] === undefined) colour = parseColor(colour);
        const tCol = tPalette[colour];
        return [tCol[0], tCol[1], tCol[2]];
    };
    window.getPaletteColor = window.getPaletteColour;

    const setBackgroundColor = (color) => {
        if (tHex[color] === undefined) color = parseColor(color);
        nBackgroundColor = color;
    };
    window.setBackgroundColor = setBackgroundColor;
    window.setBackgroundColour = setBackgroundColor;

    window.getSize = () => [nWidth, nHeight];

    window.scroll = (n) => {
        expectNumber(1, n);
        if (n !== 0) {
            const tNewLines = [];
            const t = sEmptySpaceLine, fg = tEmptyColorLines[nTextColor], bg = tEmptyColorLines[nBackgroundColor];
            for (let newY = 1; newY <= nHeight; newY++) {
                const y = newY + n;
                tNewLines[newY] = (y >= 1 && y <= nHeight) ? tLines[y] : [t, fg, bg];
            }
            tLines = tNewLines;
            if (bVisible) {
                redraw();
                updateCursorColor();
                updateCursorPos();
            }
        }
    };

    window.getTextColor = () => nTextColor;
    window.getTextColour = () => nTextColor;
    window.getBackgroundColor = () => nBackgroundColor;
    window.getBackgroundColour = () => nBackgroundColor;

    // Returns [text, textColours, backgroundColours] for the given line.
    window.getLine = (y) => {
        expectNumber(1, y);
        if (y < 1 || y > nHeight) throw new Error("Line is out of range.");
        const line = tLines[y];
        return [line[0], line[1], line[2]];
    };

    window.setVisible = (visible) => {
        expectBoolean(1, visible);
        if (bVisible !== visible) {
            bVisible = visible;
            if (bVisible) window.redraw();
        }
    };

    window.isVisible = () => bVisible;

    window.redraw = () => {
        if (bVisible) {
            redraw();
            updatePalette();
            updateCursorBlink();
            updateCursorColor();
            updateCursorPos();
        }
    };

    window.restoreCursor = () => {
        if (bVisible) {
            updateCursorBlink();
            updateCursorColor();
            updateCursorPos();
        }
    };

    window.getPosition = () => [nX, nY];

    window.reposition = (newX, newY, newWidth, newHeight, newParent) => {
        expectNumber(1, newX);
        expectNumber(2, newY);
        if (newWidth !== undefined && newWidth !== null || newHeight !== undefined && newHeight !== null) {
            expectNumber(3, newWidth);
            expectNumber(4, newHeight);
        }
        if (newParent !== undefined && newParent !== null && typeof newParent !== "object") {
            throw new Error(`bad argument #5 (table expected, got ${type(newParent)})`);
        }

        nX = newX;
        nY = newY;
        if (newParent) parent = newParent;

        if (newWidth && newHeight) {
            const tNewLines = [];
            createEmptyLines(newWidth);
            const t = sEmptySpaceLine, fg = tEmptyColorLines[nTextColor], bg = tEmptyColorLines[nBackgroundColor];
            for (let y = 1; y <= newHeight; y++) {
                if (y > nHeight) {
                    tNewLines[y] = [t, fg, bg];
                } else {
                    const old = tLines[y];
                    if (newWidth === nWidth) {
                        tNewLines[y] = old;
                    } else if (newWidth < nWidth) {
                        tNewLines[y] = [luaSub(old[0], 1, newWidth), luaSub(old[1], 1, newWidth), luaSub(old[2], 1, newWidth)];
                    } else {
                        tNewLines[y] = [
                            old[0] + luaSub(t, nWidth + 1, newWidth),
                            old[1] + luaSub(fg, nWidth + 1, newWidth),
                            old[2] + luaSub(bg, nWidth + 1, newWidth),
                        ];
                    }
                }
            }
            nWidth = newWidth;
            nHeight = newHeight;
            tLines = tNewLines;
        }
        if (bVisible) window.redraw();
    };

    if (bVisible) window.redraw();
    return window;
}

export default { create };
