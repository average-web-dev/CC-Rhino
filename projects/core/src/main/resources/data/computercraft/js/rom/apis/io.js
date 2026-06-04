// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Emulates Lua's standard io library — mirrors the CC Lua io API, wrapping the
// native fs handles in a Handle class.
//
// Multiple return values are represented as arrays: io.open returns
// [handle, null] on success or [null, errorMessage] on failure, and Handle.read
// returns an array when given more than one format.

import colors from "/rom/apis/colors.js";

const typeOf = type; // capture the global Lua-style type() before we shadow it

function expectArg(i, v, ...types) {
    const t = typeOf(v);
    if (!types.includes(t)) {
        throw new Error(`bad argument #${i} (${types.join(" or ")} expected, got ${t})`);
    }
}

// If the result is nil and the handle is auto-closing, close it (end of file).
function checkResult(handle, result) {
    if ((result === null || result === undefined) && handle._autoclose && !handle._closed) handle.close();
    return result;
}

// A file handle which can be read or written to.
class Handle {
    constructor(handle) {
        this._handle = handle;
        this._closed = false;
        this._autoclose = false;
    }

    toString() {
        return this._closed ? "file (closed)" : "file (handle)";
    }

    _assertOpen() {
        if (this._closed) throw new Error("attempt to use a closed file");
    }

    // Close this file handle. Returns true, or [null, reason] if it cannot close.
    close() {
        this._assertOpen();
        const handle = this._handle;
        if (handle.close) {
            this._closed = true;
            handle.close();
            return true;
        }
        return [null, "attempt to close standard stream"];
    }

    // Flush any buffered output.
    flush() {
        this._assertOpen();
        if (this._handle.flush) this._handle.flush();
        return true;
    }

    // Returns an iterator function yielding successive lines, or null at EOF.
    // The file is not automatically closed.
    lines(...args) {
        this._assertOpen();
        const handle = this._handle;
        if (!handle.read && !handle.readLine) return [null, "file is not readable"];

        return () => {
            if (this._closed) throw new Error("file is already closed");
            return checkResult(this, this.read(...args));
        };
    }

    // Reads data using the given formats ("l", "L", "a", numeric byte counts).
    // Returns the data; with multiple formats returns an array.
    read(...formats) {
        this._assertOpen();
        const handle = this._handle;
        if (!handle.read && !handle.readLine) return [null, "Not opened for reading"];

        const n = formats.length;
        const output = [];
        for (let i = 0; i < n; i++) {
            const arg = formats[i];
            let res;
            if (typeOf(arg) === "number") {
                if (handle.read) res = handle.read(arg);
            } else if (typeOf(arg) === "string") {
                const format = arg.replace(/^\*/, "").slice(0, 1);
                if (format === "l") {
                    if (handle.readLine) res = handle.readLine();
                } else if (format === "L") {
                    if (handle.readLine) res = handle.readLine(true);
                } else if (format === "a") {
                    if (handle.readAll) res = handle.readAll() ?? "";
                } else if (format === "n") {
                    res = null; // unsupported in CC
                } else {
                    throw new Error(`bad argument #${i + 1} (invalid format)`);
                }
            } else {
                throw new Error(`bad argument #${i + 1} (string expected, got ${typeOf(arg)})`);
            }

            output[i] = res;
            if (res === null || res === undefined) break;
        }

        if (n === 0 && handle.readLine) return handle.readLine();
        return n === 1 ? output[0] : output;
    }

    // Seek the file cursor. Returns the new position, or [null, reason].
    seek(whence, offset) {
        this._assertOpen();
        const handle = this._handle;
        if (!handle.seek) return [null, "file is not seekable"];
        return handle.seek(whence, offset);
    }

    // No effect in CC; exists for Lua compatibility.
    setvbuf(_mode, _size) {}

    // Write one or more values. Returns this handle for chaining, or [null, err].
    write(...args) {
        this._assertOpen();
        const handle = this._handle;
        if (!handle.write) return [null, "file is not writable"];

        for (let i = 0; i < args.length; i++) {
            expectArg(i + 1, args[i], "string", "number");
            handle.write(args[i]);
        }
        return this;
    }
}

function makeFile(handle) {
    return new Handle(handle);
}

function isHandle(v) {
    return v instanceof Handle;
}

const defaultInput = makeFile({ readLine: (...a) => globalThis.read(...a) });
const defaultOutput = makeFile({ write: (...a) => globalThis.write(...a) });
const defaultError = makeFile({
    write: (...a) => {
        let oldColour;
        if (term.isColour()) {
            oldColour = term.getTextColour();
            term.setTextColour(colors.red);
        }
        globalThis.write(...a);
        if (term.isColour()) term.setTextColour(oldColour);
    },
});

let currentInput = defaultInput;
let currentOutput = defaultOutput;

// Standard streams.
const stdin = defaultInput;
const stdout = defaultOutput;
const stderr = defaultError;

// Open a file. Returns [handle, null] on success or [null, errorMessage].
function open(filename, mode) {
    expectArg(1, filename, "string");
    expectArg(2, mode, "string", "nil");

    const res = fs.open(filename, mode ?? "r");
    if (!res || (Array.isArray(res) && !res[0])) {
        return [null, Array.isArray(res) ? (res[1] ?? "Unable to open file") : "Unable to open file"];
    }
    return [makeFile(Array.isArray(res) ? res[0] : res), null];
}

// Close the given file (or the current output file).
function close(file) {
    if (file === undefined || file === null) return currentOutput.close();
    if (!isHandle(file)) throw new Error(`bad argument #1 (FILE expected, got ${typeOf(file)})`);
    return file.close();
}

// Flush the current output file.
function flush() {
    return currentOutput.flush();
}

// Get or set the current input file (by path or handle).
function input(file) {
    if (typeOf(file) === "string") {
        const [res, err] = open(file, "r");
        if (!res) throw new Error(err);
        currentInput = res;
    } else if (isHandle(file)) {
        currentInput = file;
    } else if (file !== undefined && file !== null) {
        throw new Error(`bad argument #1 (FILE expected, got ${typeOf(file)})`);
    }
    return currentInput;
}

// Open `filename` and return a line iterator, closing the file at EOF. With no
// filename, uses the current input file.
function lines(filename, ...args) {
    expectArg(1, filename, "string", "nil");
    if (filename) {
        const [ok, err] = open(filename, "r");
        if (!ok) throw new Error(err);
        ok._autoclose = true;
        return ok.lines(...args);
    }
    return currentInput.lines(...args);
}

// Get or set the current output file (by path or handle).
function output(file) {
    if (typeOf(file) === "string") {
        const [res, err] = open(file, "wb");
        if (!res) throw new Error(err);
        currentOutput = res;
    } else if (isHandle(file)) {
        currentOutput = file;
    } else if (file !== undefined && file !== null) {
        throw new Error(`bad argument #1 (FILE expected, got ${typeOf(file)})`);
    }
    return currentOutput;
}

// Read from the current input file (equivalent to io.input().read(...)).
function read(...args) {
    return currentInput.read(...args);
}

// Returns "file" for an open handle, "closed file" for a closed one, else null.
function ioType(obj) {
    if (isHandle(obj)) return obj._closed ? "closed file" : "file";
    return null;
}

// Write to the current output file (equivalent to io.output().write(...)).
function write(...args) {
    return currentOutput.write(...args);
}

export default {
    stdin, stdout, stderr,
    open, close, flush, input, lines, output, read, write,
    type: ioType,
    Handle,
};
