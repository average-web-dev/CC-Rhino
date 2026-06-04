// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Communicate with other computers using modems.
//
// Unlike the CC Lua rednet API (which blocks inside coroutines and is driven by
// os.pullEvent), this is a normal, idiomatic JS module:
//
//   - It is a Node-style event emitter. Register a persistent listener with
//     rednet.on("message", handler) and the handler is invoked, with a
//     { id, message, protocol } object, every time a message arrives. on()
//     returns an unsubscribe function; once()/off() work as you'd expect.
//
//   - rednet.receive([protocol], [timeout]) is a thin promise wrapper for the
//     common "wait for the next message" case. It resolves with a message
//     object (or null on timeout) — no event loop to write by hand.
//
//   - Everything that touches a modem (open/close/send/broadcast/...) is async
//     and returns a Promise.
//
// rednet is a thin abstraction over the modem peripheral.

import peripheral from "/rom/apis/peripheral.js";

// The channel used by rednet to broadcast messages.
const CHANNEL_BROADCAST = 65535;
// The channel used by rednet to repeat messages.
const CHANNEL_REPEAT = 65533;
// The number of channels rednet reserves for computer IDs.
const MAX_ID_CHANNELS = 65500;

const receivedMessages = new Map(); // messageId -> deadline (os.clock)
const hostnames = {};               // protocol -> hostname
let pruneReceivedTimer = null;

function idAsChannel(id) {
    return (id ?? os.getComputerID()) % MAX_ID_CHANNELS;
}

function expect(i, v, ...types) {
    const t = type(v);
    if (!types.includes(t)) {
        throw new Error(`bad argument #${i} (${types.join(" or ")} expected, got ${t})`);
    }
}

// ── Event emitter ─────────────────────────────────────────────────────────────
// rednet is a Node-style event source. It owns its own EventEmitter (the same
// class the runtime uses for os events) and re-exports on/once/off so callers
// can subscribe to the single "message" event it emits.

const bus = new EventEmitter();

// Register `fn` to run every time `event` fires. Returns an unsubscribe
// function, so `const stop = rednet.on(...)` reads naturally.
function on(event, fn) {
    expect(2, fn, "function");
    bus.on(event, fn);
    return () => bus.off(event, fn);
}

// Register `fn` to run the next time `event` fires, then remove it.
function once(event, fn) {
    expect(2, fn, "function");
    bus.once(event, fn);
    return () => bus.off(event, fn);
}

// Remove a previously registered listener.
function off(event, fn) {
    bus.off(event, fn);
}

// Deliver an incoming message to all "message" listeners.
function dispatch(id, message, protocol) {
    bus.emit("message", { id, message, protocol });
}

// ── Timers ────────────────────────────────────────────────────────────────────

// A cancellable delay. Returns { promise, cancel } where `promise` resolves
// after `seconds`, and `cancel()` resolves it early and cleans up the timer.
function delay(seconds) {
    const id = os.startTimer(seconds);
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const handler = (tid) => {
        if (tid !== id) return;
        os.off("timer", handler);
        resolve();
    };
    os.on("timer", handler);
    return {
        promise,
        cancel() {
            os.off("timer", handler);
            os.cancelTimer(id);
        },
    };
}

// ── Modem control ─────────────────────────────────────────────────────────────

// Opens a modem so it can send and receive rednet messages, on the computer's
// ID channel and the broadcast channel.
async function open(modem) {
    expect(1, modem, "string");
    if ((await peripheral.getType(modem))?.[0] !== "modem") {
        throw new Error("No such modem: " + modem);
    }
    await peripheral.call(modem, "open", idAsChannel());
    await peripheral.call(modem, "open", CHANNEL_BROADCAST);
}

// Close a modem (or all open modems if none is given).
async function close(modem) {
    expect(1, modem, "string", "nil");
    if (modem) {
        if ((await peripheral.getType(modem))?.[0] !== "modem") {
            throw new Error("No such modem: " + modem);
        }
        await peripheral.call(modem, "close", idAsChannel());
        await peripheral.call(modem, "close", CHANNEL_BROADCAST);
    } else {
        for (const m of await peripheral.getNames()) {
            if (await isOpen(m)) await close(m);
        }
    }
}

// Determine if rednet is currently open (on the given modem, or any modem).
async function isOpen(modem) {
    expect(1, modem, "string", "nil");
    if (modem) {
        if ((await peripheral.getType(modem))?.[0] === "modem") {
            return (await peripheral.call(modem, "isOpen", idAsChannel()))
                && (await peripheral.call(modem, "isOpen", CHANNEL_BROADCAST));
        }
    } else {
        for (const m of await peripheral.getNames()) {
            if (await isOpen(m)) return true;
        }
    }
    return false;
}

// ── Sending ───────────────────────────────────────────────────────────────────

// Send a message to a computer with a specific ID. Returns whether rednet was
// open (not whether the message was received).
async function send(recipient, message, protocol) {
    expect(1, recipient, "number");
    expect(3, protocol, "string", "nil");

    const messageId = Math.floor(Math.random() * 2147483647) + 1;
    receivedMessages.set(messageId, os.clock() + 9.5);
    if (!pruneReceivedTimer) pruneReceivedTimer = os.startTimer(10);

    const replyChannel = idAsChannel();
    const messageWrapper = {
        nMessageID: messageId,
        nRecipient: recipient,
        nSender: os.getComputerID(),
        message,
        sProtocol: protocol,
    };

    let sent = false;
    if (recipient === os.getComputerID()) {
        // Deliver to ourselves on the next microtask, so send() returns before
        // listeners run (mirrors how a real round-trip would behave, and avoids
        // re-entering a listener that is mid-send).
        Promise.resolve().then(() => dispatch(os.getComputerID(), message, protocol));
        sent = true;
    } else {
        if (recipient !== CHANNEL_BROADCAST) recipient = idAsChannel(recipient);
        for (const modem of await peripheral.getNames()) {
            if (await isOpen(modem)) {
                await peripheral.call(modem, "transmit", recipient, replyChannel, messageWrapper);
                await peripheral.call(modem, "transmit", CHANNEL_REPEAT, replyChannel, messageWrapper);
                sent = true;
            }
        }
    }

    return sent;
}

// Broadcast a message over the broadcast channel to every rednet device.
async function broadcast(message, protocol) {
    expect(2, protocol, "string", "nil");
    await send(CHANNEL_BROADCAST, message, protocol);
}

// ── Receiving ─────────────────────────────────────────────────────────────────

// Wait for a single rednet message and resolve with it. The result is a message
// object { id, message, protocol }, or null if `timeout` (seconds) elapses
// first. Pass `protocol` to only resolve for messages on that protocol.
//
// For ongoing handling prefer rednet.on("message", handler) — receive() is just
// a one-shot built on the same event.
function receive(protocol, timeout) {
    // Convenience overload: receive(timeout).
    if (typeof protocol === "number" && timeout === undefined) {
        timeout = protocol;
        protocol = undefined;
    }
    expect(1, protocol, "string", "nil");
    expect(2, timeout, "number", "nil");

    return new Promise((resolve) => {
        let timer = null;
        const remove = on("message", (msg) => {
            if (protocol == null || msg.protocol === protocol) {
                remove();
                timer?.cancel();
                resolve(msg);
            }
        });
        if (timeout != null) {
            timer = delay(timeout);
            timer.promise.then(() => {
                remove();
                resolve(null);
            });
        }
    });
}

// ── DNS / hosting ─────────────────────────────────────────────────────────────

// Register this computer as hosting `protocol` under `hostname`.
async function host(protocol, hostname) {
    expect(1, protocol, "string");
    expect(2, hostname, "string");
    if (hostname === "localhost") throw new Error("Reserved hostname");
    if (hostnames[protocol] !== hostname) {
        if ((await lookup(protocol, hostname)) !== null) throw new Error("Hostname in use");
        hostnames[protocol] = hostname;
    }
}

// Stop hosting a specific protocol.
function unhost(protocol) {
    expect(1, protocol, "string");
    delete hostnames[protocol];
}

// Search the network for systems hosting `protocol`. Without a hostname returns
// an array of computer IDs; with a hostname returns a single ID or null.
async function lookup(protocol, hostname, timeout) {
    expect(1, protocol, "string");
    expect(2, hostname, "string", "nil");
    expect(3, timeout, "number", "nil");

    const collecting = hostname == null;
    const results = collecting ? [] : null;

    // Check localhost first.
    if (hostnames[protocol]) {
        if (collecting) {
            results.push(os.getComputerID());
        } else if (hostname === "localhost" || hostname === hostnames[protocol]) {
            return os.getComputerID();
        }
    }

    if (!(await isOpen())) {
        return results;
    }

    await broadcast({ sType: "lookup", sProtocol: protocol, sHostname: hostname }, "dns");

    // Collect responses via a listener until the timer fires (or, when looking
    // up a specific hostname, until the first match).
    return new Promise((resolve) => {
        const timer = delay(timeout ?? 2);

        const finish = (value) => {
            remove();
            timer.cancel();
            resolve(value);
        };

        const remove = on("message", ({ id, message, protocol: messageProtocol }) => {
            if (messageProtocol === "dns" && type(message) === "table"
                && message.sType === "lookup response" && message.sProtocol === protocol) {
                if (collecting) {
                    results.push(id);
                } else if (message.sHostname === hostname) {
                    finish(id);
                }
            }
        });

        timer.promise.then(() => finish(results));
    });
}

// ── Background service ─────────────────────────────────────────────────────────

let started = false;

// Listen for modem messages and turn them into rednet "message" events, and run
// the built-in DNS responder. Started automatically in the background on
// startup; should not be called manually.
function run() {
    if (started) throw new Error("rednet is already running");
    started = true;

    os.on("modem_message", async (modem, channel, replyChannel, message) => {
        if (channel !== idAsChannel() && channel !== CHANNEL_BROADCAST) return;
        if (type(message) !== "table" || typeof message.nMessageID !== "number"
            || Number.isNaN(message.nMessageID) || receivedMessages.has(message.nMessageID)) return;
        if (!(message.nSender === undefined || message.nSender === null
            || (typeof message.nSender === "number" && !Number.isNaN(message.nSender)))) return;
        if (!((message.nRecipient && message.nRecipient === os.getComputerID()) || channel === CHANNEL_BROADCAST)) return;
        if (!(await isOpen(modem))) return;

        receivedMessages.set(message.nMessageID, os.clock() + 9.5);
        if (!pruneReceivedTimer) pruneReceivedTimer = os.startTimer(10);
        dispatch(message.nSender ?? replyChannel, message.message, message.sProtocol);
    });

    // Answer DNS lookups for protocols we host.
    on("message", async ({ id, message, protocol }) => {
        if (protocol === "dns" && type(message) === "table" && message.sType === "lookup") {
            const hostname = hostnames[message.sProtocol];
            if (hostname !== undefined && hostname !== null
                && (message.sHostname === undefined || message.sHostname === null || message.sHostname === hostname)) {
                await send(id, { sType: "lookup response", sHostname: hostname, sProtocol: message.sProtocol }, "dns");
            }
        }
    });

    os.on("timer", (id) => {
        if (id !== pruneReceivedTimer) return;
        pruneReceivedTimer = null;
        const now = os.clock();
        let hasMore = false;
        for (const [messageId, deadline] of receivedMessages) {
            if (deadline <= now) receivedMessages.delete(messageId);
            else hasMore = true;
        }
        pruneReceivedTimer = hasMore ? os.startTimer(10) : null;
    });
}

export default {
    CHANNEL_BROADCAST, CHANNEL_REPEAT, MAX_ID_CHANNELS,
    open, close, isOpen, send, broadcast,
    on, once, off, receive,
    host, unhost, lookup, run,
};
