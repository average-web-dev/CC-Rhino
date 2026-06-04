// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Utilities for drawing more complex graphics, such as pixels, lines and images
// — mirrors the CC Lua paintutils API. Terminal coordinates are 1-based, as in
// Lua. Parsed images are arrays of rows, each row an array of colour values.

import colours from "/rom/apis/colours.js";

function drawPixelInternal(xPos, yPos) {
    term.setCursorPos(xPos, yPos);
    term.write(" ");
}

const HEX = "0123456789abcdef";
const colourLookup = {};
for (let n = 0; n < 16; n++) colourLookup[HEX[n]] = 2 ** n;

function parseLine(image, line) {
    const row = [];
    for (let x = 0; x < line.length; x++) row[x] = colourLookup[line[x]] ?? 0;
    image.push(row);
}

// Sorts start/end pairs so the start is always the minimum.
function sortCoords(startX, startY, endX, endY) {
    return [
        Math.min(startX, endX), Math.max(startX, endX),
        Math.min(startY, endY), Math.max(startY, endY),
    ];
}

function expectNumber(i, v) {
    if (typeof v !== "number") throw new Error(`bad argument #${i} (number expected, got ${type(v)})`);
}

// Parses an image from a multi-line string into image data for drawImage.
function parseImage(image) {
    if (typeof image !== "string") throw new Error(`bad argument #1 (string expected, got ${type(image)})`);
    const result = [];
    for (const line of (image + "\n").split("\n").slice(0, -1)) parseLine(result, line);
    return result;
}

// Loads an image from a file, or returns null if it does not exist.
function loadImage(path) {
    if (typeof path !== "string") throw new Error(`bad argument #1 (string expected, got ${type(path)})`);
    if (fs.exists(path)) {
        const file = fs.open(path, "r");
        const content = file.readAll();
        file.close();
        return parseImage(content);
    }
    return null;
}

// Draws a single pixel at the given position, optionally setting the colour.
// May change cursor position and background colour.
function drawPixel(xPos, yPos, colour) {
    expectNumber(1, xPos);
    expectNumber(2, yPos);
    if (colour !== undefined && colour !== null) term.setBackgroundColor(colour);
    drawPixelInternal(xPos, yPos);
}

// Draws a straight line from start to end. May change cursor and background.
function drawLine(startX, startY, endX, endY, colour) {
    expectNumber(1, startX);
    expectNumber(2, startY);
    expectNumber(3, endX);
    expectNumber(4, endY);

    startX = Math.floor(startX);
    startY = Math.floor(startY);
    endX = Math.floor(endX);
    endY = Math.floor(endY);

    if (colour !== undefined && colour !== null) term.setBackgroundColor(colour);
    if (startX === endX && startY === endY) {
        drawPixelInternal(startX, startY);
        return;
    }

    const minX = Math.min(startX, endX);
    let maxX, minY, maxY;
    if (minX === startX) {
        minY = startY; maxX = endX; maxY = endY;
    } else {
        minY = endY; maxX = startX; maxY = startY;
    }

    const xDiff = maxX - minX;
    const yDiff = maxY - minY;

    if (xDiff > Math.abs(yDiff)) {
        let y = minY;
        const dy = yDiff / xDiff;
        for (let x = minX; x <= maxX; x++) {
            drawPixelInternal(x, Math.floor(y + 0.5));
            y += dy;
        }
    } else {
        let x = minX;
        const dx = xDiff / yDiff;
        if (maxY >= minY) {
            for (let y = minY; y <= maxY; y++) {
                drawPixelInternal(Math.floor(x + 0.5), y);
                x += dx;
            }
        } else {
            for (let y = minY; y >= maxY; y--) {
                drawPixelInternal(Math.floor(x + 0.5), y);
                x -= dx;
            }
        }
    }
}

// Draws the outline of a box. May change cursor and background.
function drawBox(startX, startY, endX, endY, nColour) {
    expectNumber(1, startX);
    expectNumber(2, startY);
    expectNumber(3, endX);
    expectNumber(4, endY);

    startX = Math.floor(startX);
    startY = Math.floor(startY);
    endX = Math.floor(endX);
    endY = Math.floor(endY);

    if (nColour !== undefined && nColour !== null) term.setBackgroundColor(nColour);
    else nColour = term.getBackgroundColour();
    const colourHex = colours.toBlit(nColour);

    if (startX === endX && startY === endY) {
        drawPixelInternal(startX, startY);
        return;
    }

    const [minX, maxX, minY, maxY] = sortCoords(startX, startY, endX, endY);
    const width = maxX - minX + 1;

    for (let y = minY; y <= maxY; y++) {
        if (y === minY || y === maxY) {
            term.setCursorPos(minX, y);
            term.blit(" ".repeat(width), colourHex.repeat(width), colourHex.repeat(width));
        } else {
            term.setCursorPos(minX, y);
            term.blit(" ", colourHex, colourHex);
            term.setCursorPos(maxX, y);
            term.blit(" ", colourHex, colourHex);
        }
    }
}

// Draws a filled box. May change cursor and background.
function drawFilledBox(startX, startY, endX, endY, nColour) {
    expectNumber(1, startX);
    expectNumber(2, startY);
    expectNumber(3, endX);
    expectNumber(4, endY);

    startX = Math.floor(startX);
    startY = Math.floor(startY);
    endX = Math.floor(endX);
    endY = Math.floor(endY);

    if (nColour !== undefined && nColour !== null) term.setBackgroundColor(nColour);
    else nColour = term.getBackgroundColour();
    const colourHex = colours.toBlit(nColour);

    if (startX === endX && startY === endY) {
        drawPixelInternal(startX, startY);
        return;
    }

    const [minX, maxX, minY, maxY] = sortCoords(startX, startY, endX, endY);
    const width = maxX - minX + 1;

    for (let y = minY; y <= maxY; y++) {
        term.setCursorPos(minX, y);
        term.blit(" ".repeat(width), colourHex.repeat(width), colourHex.repeat(width));
    }
}

// Draws an image (from parseImage/loadImage) at the given position.
function drawImage(image, xPos, yPos) {
    if (!Array.isArray(image)) throw new Error(`bad argument #1 (table expected, got ${type(image)})`);
    expectNumber(2, xPos);
    expectNumber(3, yPos);
    for (let y = 0; y < image.length; y++) {
        const row = image[y];
        for (let x = 0; x < row.length; x++) {
            if (row[x] > 0) {
                term.setBackgroundColor(row[x]);
                drawPixelInternal(x + xPos, y + yPos);
            }
        }
    }
}

export default {
    parseImage, loadImage, drawPixel, drawLine, drawBox, drawFilledBox, drawImage,
};
