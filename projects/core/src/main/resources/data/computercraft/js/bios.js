// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
// SPDX-License-Identifier: MPL-2.0

// JavaScript BIOS — the rough equivalent of lua/bios.lua, adapted to this
// runtime. The major differences from the Lua BIOS:
//
//   - Events use a Node-style emitter: register handlers with os.on / os.once and
//     remove them with os.off. There is no os.pullEvent — code reacts to events
//     instead of blocking on them.
//   - Code is loaded with ES module `import`. There is no loadfile/dofile/loadAPI;
//     APIs and programs are just modules.
//   - The rom APIs are ES modules; the BIOS imports them at boot and exposes the
//     common ones as globals, mirroring how bios.lua loads rom/apis.

// ── Lua-compatible value shims ────────────────────────────────────────────────
// The transpiled rom APIs still use Lua-style tostring/type/etc, so we keep them.

globalThis.tostring = (v) => {
    if (v === null || v === undefined) return "nil";
    return String(v);
};

globalThis.tonumber = (v, base) => {
    if (v === null || v === undefined) return null;
    const n = base ? parseInt(String(v), base) : Number(v);
    return Number.isNaN(n) ? null : n;
};

globalThis.type = (v) => {
    if (v === null || v === undefined) return "nil";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    if (typeof v === "function") return "function";
    return "table";
};

globalThis.pcall = async (fn, ...args) => {
    try {
        return [true, await fn(...args)];
    } catch (e) {
        return [false, String(e && e.message ? e.message : e)];
    }
};

globalThis.error = (msg, _level) => { throw new Error(msg); };

// A "bit" library shim, matching bios.lua's bit32-backed stub. JS bitwise
// operators are 32-bit; we mask to unsigned where Lua's bit32 would.
globalThis.bit = {
    bnot: (a) => (~a) >>> 0,
    band: (a, b) => (a & b) >>> 0,
    bor: (a, b) => (a | b) >>> 0,
    bxor: (a, b) => (a ^ b) >>> 0,
    brshift: (a, n) => a >> n,          // arithmetic shift (bit32.arshift)
    blshift: (a, n) => (a << n) >>> 0,
    blogic_rshift: (a, n) => a >>> n,   // logical shift (bit32.rshift)
};

// Module-level handles to APIs the helpers below need. Assigned during boot.
let colors;
let keys;

// ── Globals: timing ───────────────────────────────────────────────────────────

globalThis.sleep = (nTime) => {
    const timer = os.startTimer(nTime ?? 0);
    return new Promise((resolve) => {
        const handler = (id) => {
            if (id === timer) {
                os.off("timer", handler);
                resolve();
            }
        };
        os.on("timer", handler);
    });
};

os.version = () => "CraftOS 1.9";
os.sleep = (nTime) => sleep(nTime);

// ── Globals: terminal output ──────────────────────────────────────────────────

// write() with word wrapping and scrolling. Returns the number of lines printed.
globalThis.write = (sText) => {
    sText = tostring(sText);

    const [w, h] = term.getSize();
    let [x, y] = term.getCursorPos();

    let nLinesPrinted = 0;
    const newLine = () => {
        if (y + 1 <= h) {
            term.setCursorPos(1, y + 1);
        } else {
            term.setCursorPos(1, h);
            term.scroll(1);
        }
        [x, y] = term.getCursorPos();
        nLinesPrinted++;
    };

    while (sText.length > 0) {
        const whitespace = sText.match(/^[ \t]+/);
        if (whitespace) {
            term.write(whitespace[0]);
            [x, y] = term.getCursorPos();
            sText = sText.slice(whitespace[0].length);
        }

        if (sText[0] === "\n") {
            newLine();
            sText = sText.slice(1);
        }

        const word = sText.match(/^[^ \t\n]+/);
        if (word) {
            let text = word[0];
            sText = sText.slice(text.length);
            if (text.length > w) {
                // A word longer than the screen: print it across multiple lines.
                while (text.length > 0) {
                    if (x > w) newLine();
                    term.write(text);
                    text = text.slice(w - x + 1);
                    [x, y] = term.getCursorPos();
                }
            } else {
                if (x + text.length - 1 > w) newLine();
                term.write(text);
                [x, y] = term.getCursorPos();
            }
        }
    }

    return nLinesPrinted;
};

globalThis.print = (...args) => {
    let nLinesPrinted = 0;
    const nLimit = args.length;
    for (let n = 0; n < nLimit; n++) {
        let s = tostring(args[n]);
        if (n < nLimit - 1) s += "\t";
        nLinesPrinted += write(s);
    }
    nLinesPrinted += write("\n");
    return nLinesPrinted;
};

globalThis.printError = (...args) => {
    let oldColour;
    const isColour = term.isColour();
    if (isColour) {
        oldColour = term.getTextColour();
        term.setTextColour(colors.red);
    }
    print(...args);
    if (isColour) term.setTextColour(oldColour);
};

// ── read() — full line editor ─────────────────────────────────────────────────
// Supports masking, history, completion, default text, cursor movement, paste,
// mouse positioning, resizing and horizontal scrolling — a port of bios.lua,
// rewritten around os.on/os.off listeners rather than a pullEvent loop. Resolves
// with the entered line, or rejects with "Terminated".

globalThis.read = (sReplaceChar, tHistory, fnComplete, sDefault) => new Promise((resolve, reject) => {
    term.setCursorBlink(true);

    let sLine = typeof sDefault === "string" ? sDefault : "";
    let nHistoryPos;
    let nPos = sLine.length;
    let nScroll = 0;
    if (sReplaceChar) sReplaceChar = sReplaceChar.slice(0, 1);

    let tCompletions;
    let nCompletion;
    const recomplete = () => {
        if (fnComplete && nPos === sLine.length) {
            tCompletions = fnComplete(sLine);
            nCompletion = (tCompletions && tCompletions.length > 0) ? 0 : undefined;
        } else {
            tCompletions = undefined;
            nCompletion = undefined;
        }
    };
    const uncomplete = () => {
        tCompletions = undefined;
        nCompletion = undefined;
    };

    let [w] = term.getSize();
    const [sx] = term.getCursorPos();

    const redraw = (bClear) => {
        const cursorPos = nPos - nScroll;
        if (sx + cursorPos >= w) {
            nScroll = sx + nPos - w;
        } else if (cursorPos < 0) {
            nScroll = nPos;
        }

        const cy = term.getCursorPos()[1];
        term.setCursorPos(sx, cy);
        const sReplace = bClear ? " " : sReplaceChar;
        if (sReplace) {
            term.write(sReplace.repeat(Math.max(sLine.length - nScroll, 0)));
        } else {
            term.write(sLine.slice(nScroll));
        }

        if (nCompletion !== undefined) {
            const sCompletion = tCompletions[nCompletion];
            let oldText, oldBg;
            if (!bClear) {
                oldText = term.getTextColor();
                oldBg = term.getBackgroundColor();
                term.setTextColor(colors.white);
                term.setBackgroundColor(colors.gray);
            }
            if (sReplace) term.write(sReplace.repeat(sCompletion.length));
            else term.write(sCompletion);
            if (!bClear) {
                term.setTextColor(oldText);
                term.setBackgroundColor(oldBg);
            }
        }

        term.setCursorPos(sx + nPos - nScroll, cy);
    };

    const clear = () => redraw(true);

    const acceptCompletion = () => {
        if (nCompletion !== undefined) {
            clear();
            sLine += tCompletions[nCompletion];
            nPos = sLine.length;
            recomplete();
            redraw();
        }
    };

    let done = false;
    const handlers = {};
    const cleanup = () => {
        for (const name of Object.keys(handlers)) os.off(name, handlers[name]);
    };
    const finish = () => {
        if (done) return;
        done = true;
        const cy = term.getCursorPos()[1];
        term.setCursorBlink(false);
        term.setCursorPos(w + 1, cy);
        print();
        cleanup();
        resolve(sLine);
    };

    const onMouse = (mx, my) => {
        const cy = term.getCursorPos()[1];
        if (mx >= sx && mx <= w && my === cy) {
            nPos = Math.min(Math.max(nScroll + mx - sx, 0), sLine.length);
            redraw();
        }
    };

    handlers.char = (param) => {
        if (done) return;
        clear();
        sLine = sLine.slice(0, nPos) + param + sLine.slice(nPos);
        nPos += 1;
        recomplete();
        redraw();
    };

    handlers.paste = (param) => {
        if (done) return;
        clear();
        sLine = sLine.slice(0, nPos) + param + sLine.slice(nPos);
        nPos += param.length;
        recomplete();
        redraw();
    };

    handlers.key = (param) => {
        if (done) return;
        if (param === keys.enter || param === keys.numPadEnter) {
            if (nCompletion !== undefined) {
                clear();
                uncomplete();
                redraw();
            }
            finish();
        } else if (param === keys.left) {
            if (nPos > 0) { clear(); nPos -= 1; recomplete(); redraw(); }
        } else if (param === keys.right) {
            if (nPos < sLine.length) { clear(); nPos += 1; recomplete(); redraw(); }
            else acceptCompletion();
        } else if (param === keys.up || param === keys.down) {
            if (nCompletion !== undefined) {
                clear();
                if (param === keys.up) {
                    nCompletion -= 1;
                    if (nCompletion < 0) nCompletion = tCompletions.length - 1;
                } else {
                    nCompletion += 1;
                    if (nCompletion >= tCompletions.length) nCompletion = 0;
                }
                redraw();
            } else if (tHistory) {
                clear();
                if (param === keys.up) {
                    if (nHistoryPos === undefined) {
                        if (tHistory.length > 0) nHistoryPos = tHistory.length - 1;
                    } else if (nHistoryPos > 0) {
                        nHistoryPos -= 1;
                    }
                } else {
                    if (nHistoryPos === tHistory.length - 1) nHistoryPos = undefined;
                    else if (nHistoryPos !== undefined) nHistoryPos += 1;
                }
                if (nHistoryPos !== undefined) {
                    sLine = tHistory[nHistoryPos];
                    nPos = sLine.length;
                    nScroll = 0;
                } else {
                    sLine = "";
                    nPos = 0;
                    nScroll = 0;
                }
                uncomplete();
                redraw();
            }
        } else if (param === keys.backspace) {
            if (nPos > 0) {
                clear();
                sLine = sLine.slice(0, nPos - 1) + sLine.slice(nPos);
                nPos -= 1;
                if (nScroll > 0) nScroll -= 1;
                recomplete();
                redraw();
            }
        } else if (param === keys.home) {
            if (nPos > 0) { clear(); nPos = 0; recomplete(); redraw(); }
        } else if (param === keys.delete) {
            if (nPos < sLine.length) {
                clear();
                sLine = sLine.slice(0, nPos) + sLine.slice(nPos + 1);
                recomplete();
                redraw();
            }
        } else if (param === keys.end) {
            if (nPos < sLine.length) { clear(); nPos = sLine.length; recomplete(); redraw(); }
        } else if (param === keys.tab) {
            acceptCompletion();
        }
    };

    handlers.mouse_click = (_button, mx, my) => { if (!done) onMouse(mx, my); };
    handlers.mouse_drag = (button, mx, my) => { if (!done && button === 1) onMouse(mx, my); };
    handlers.term_resize = () => {
        if (done) return;
        [w] = term.getSize();
        redraw();
    };
    handlers.terminate = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Terminated"));
    };

    recomplete();
    redraw();

    for (const name of Object.keys(handlers)) os.on(name, handlers[name]);
});

// ── Program loading ───────────────────────────────────────────────────────────

function normalisePath(path) {
    let p = path.startsWith("/") ? path : "/" + path;
    if (!/\.[a-zA-Z0-9]+$/.test(p)) p += ".js";
    return p;
}

// Run a program module with the given arguments. Returns whether it succeeded.
os.run = async (_env, path, ...args) => {
    try {
        const mod = await import(normalisePath(path));
        if (typeof mod.default === "function") await mod.default(...args);
        return true;
    } catch (e) {
        if (String(e).includes("Terminated")) throw e;
        const msg = String(e && e.message ? e.message : e);
        if (msg) printError(msg);
        return false;
    }
};

// Override shutdown/reboot to halt execution afterwards, as bios.lua does.
const nativeShutdown = os.shutdown;
const nativeReboot = os.reboot;
os.shutdown = () => { nativeShutdown(); return new Promise(() => {}); };
os.reboot = () => { nativeReboot(); return new Promise(() => {}); };

// ── Default settings ──────────────────────────────────────────────────────────

function defineDefaults(settings) {
    const noCommands = typeof commands === "undefined" || !commands;
    const noPocket = typeof pocket === "undefined" || !pocket;

    settings.define("shell.allow_startup", {
        default: true, type: "boolean",
        description: "Run startup files when the computer turns on.",
    });
    settings.define("shell.allow_disk_startup", {
        default: noCommands, type: "boolean",
        description: "Run startup files from disk drives when the computer turns on.",
    });
    settings.define("shell.autocomplete", {
        default: true, type: "boolean",
        description: "Autocomplete program and arguments in the shell.",
    });
    settings.define("edit.autocomplete", {
        default: true, type: "boolean",
        description: "Autocomplete API and function names in the editor.",
    });
    settings.define("js.autocomplete", {
        default: true, type: "boolean",
        description: "Autocomplete API and function names in the JS REPL.",
    });
    settings.define("edit.default_extension", {
        default: "js", type: "string",
        description: 'The file extension the editor will use if none is given. Set to "" to disable.',
    });
    settings.define("paint.default_extension", {
        default: "nfp", type: "string",
        description: 'The file extension the paint program will use if none is given. Set to "" to disable.',
    });
    settings.define("list.show_hidden", {
        default: false, type: "boolean",
        description: 'Whether the list program show hidden files (those starting with ".").',
    });
    settings.define("motd.enable", {
        default: noPocket, type: "boolean",
        description: "Display a random message when the computer starts up.",
    });
    settings.define("motd.path", {
        default: "/rom/motd.txt:/motd.txt", type: "string",
        description: 'The path to load random messages from. Should be a colon (":") separated string of file paths.',
    });
    settings.define("js.warn_against_use_of_local", {
        default: true, type: "boolean",
        description: "Print a message when input in the JS REPL declares a variable with let/const, which will be inaccessible on the next input.",
    });
    settings.define("js.function_args", {
        default: true, type: "boolean",
        description: "Show function arguments when printing functions.",
    });
    settings.define("js.function_source", {
        default: false, type: "boolean",
        description: "Show where a function was defined when printing functions.",
    });
    settings.define("bios.strict_globals", {
        default: false, type: "boolean",
        description: "Prevents assigning variables into a program's environment.",
    });
    settings.define("shell.autocomplete_hidden", {
        default: false, type: "boolean",
        description: 'Autocomplete hidden files and folders (those starting with ".").',
    });
    if (term.isColour()) {
        settings.define("bios.use_multishell", {
            default: true, type: "boolean",
            description: 'Allow running multiple programs at once, through the "fg" and "bg" programs.',
        });
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

os.once("__start__", async () => {
    const load = async (p) => (await import(p)).default;
    try {
        // Import turtle/command APIs first, while `peripheral` is still the host
        // (synchronous) global they capture internally.
        let turtleApi, commandsApi;
        if (typeof turtle !== "undefined" && turtle) {
            turtleApi = await load("/rom/apis/turtle/turtle.js");
        }
        if (typeof commands !== "undefined" && commands) {
            commandsApi = await load("/rom/apis/command/commands.js");
        }

        // Load the rest of the rom APIs.
        colors = await load("/rom/apis/colors.js");
        const colours = await load("/rom/apis/colours.js");
        keys = await load("/rom/apis/keys.js");
        const textutils = await load("/rom/apis/textutils.js");
        const settings = await load("/rom/apis/settings.js");
        const parallel = await load("/rom/apis/parallel.js");
        const rednet = await load("/rom/apis/rednet.js");
        const vector = await load("/rom/apis/vector.js");
        const paintutils = await load("/rom/apis/paintutils.js");
        const windowApi = await load("/rom/apis/window.js");
        const disk = await load("/rom/apis/disk.js");
        const gps = await load("/rom/apis/gps.js");
        const helpApi = await load("/rom/apis/help.js");
        const io = await load("/rom/apis/io.js");
        const romPeripheral = await load("/rom/apis/peripheral.js");
        const romTerm = await load("/rom/apis/term.js");
        let httpApi;
        if (typeof http !== "undefined" && http) httpApi = await load("/rom/apis/http/http.js");

        // Expose APIs as globals (mirrors bios.lua's load_apis).
        Object.assign(globalThis, {
            colors, colours, keys, textutils, settings, parallel, rednet,
            vector, paintutils, disk, gps, io,
        });
        globalThis.window = windowApi;
        globalThis.help = helpApi;
        globalThis.peripheral = romPeripheral;
        globalThis.term = romTerm;
        if (httpApi) globalThis.http = httpApi;
        if (turtleApi) globalThis.turtle = turtleApi;
        if (commandsApi) {
            globalThis.commands = commandsApi;
            globalThis.exec = commandsApi.exec;
        }

        // Apply default settings, env overrides and the user's saved settings.
        defineDefaults(settings);
        if (typeof _CC_DEFAULT_SETTINGS !== "undefined" && _CC_DEFAULT_SETTINGS) {
            for (const pair of String(_CC_DEFAULT_SETTINGS).split(",")) {
                const m = pair.match(/^([^=]*)=(.*)$/);
                if (m) {
                    const name = m[1];
                    const raw = m[2];
                    let value;
                    if (raw === "true") value = true;
                    else if (raw === "false") value = false;
                    else if (raw === "nil") value = undefined;
                    else if (tonumber(raw) !== null) value = tonumber(raw);
                    else value = raw;
                    if (value !== undefined) settings.set(name, value);
                    else settings.unset(name);
                }
            }
        }
        if (fs.exists(".settings")) settings.load(".settings");

        // Start the rednet background listener (registers persistent handlers).
        try { rednet.run(); } catch (_) { /* rednet may already be running */ }

        // Run the user's startup file, if enabled and present.
        if (settings.get("shell.allow_startup", true) && fs.exists("/startup.js")) {
            try {
                const s = await import("/startup.js");
                if (typeof s.default === "function") await s.default();
            } catch (e) {
                printError("startup.js error: " + e);
            }
        }

        // Run the shell (multishell on advanced computers, if available).
        let shellPath = "/rom/programs/shell.js";
        if (romTerm.isColour() && settings.get("bios.use_multishell")
            && fs.exists("/rom/programs/advanced/multishell.js")) {
            shellPath = "/rom/programs/advanced/multishell.js";
        }
        await os.run({}, shellPath);
        await os.run({}, "/rom/programs/shutdown.js");
    } catch (e) {
        // Let the user read the error before the machine halts.
        try {
            if (globalThis.term && term.redirect && term.native) term.redirect(term.native());
        } catch (_) { /* ignore */ }
        printError("Boot error: " + (e && e.message ? e.message : e));
        try {
            term.setCursorBlink(false);
            print("Press any key to continue");
            await new Promise((r) => os.once("key", r));
        } catch (_) { /* ignore */ }
    }

    await os.shutdown();
});
