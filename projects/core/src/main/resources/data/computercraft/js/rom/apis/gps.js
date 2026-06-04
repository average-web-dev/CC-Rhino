// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Use modems to locate the position of the current turtle or computer — mirrors
// the CC Lua gps API. It pings nearby GPS hosts and trilaterates its position
// from their distances.
//
// locate() returns [x, y, z] (an array, since JS has no multiple return values)
// or null if the position could not be established.

import vector from "/rom/apis/vector.js";
import peripheral from "/rom/apis/peripheral.js";

// The channel which GPS requests and responses are broadcast on.
const CHANNEL_GPS = 65534;

// Resolve when any of the named events is next emitted, yielding [name, ...args].
function pullEvents(names) {
    return new Promise((resolve) => {
        const handlers = {};
        for (const name of names) {
            handlers[name] = (...args) => {
                for (const m of names) os.off(m, handlers[m]);
                resolve([name, ...args]);
            };
            os.on(name, handlers[name]);
        }
    });
}

// Returns an array of one or two candidate positions, or null if the fixes are
// collinear.
function trilaterate(A, B, C) {
    const a2b = B.vPosition.sub(A.vPosition);
    const a2c = C.vPosition.sub(A.vPosition);

    if (Math.abs(a2b.normalize().dot(a2c.normalize())) > 0.999) return null;

    const d = a2b.length();
    const ex = a2b.normalize();
    const i = ex.dot(a2c);
    const ey = a2c.sub(ex.mul(i)).normalize();
    const j = ey.dot(a2c);
    const ez = ex.cross(ey);

    const r1 = A.nDistance, r2 = B.nDistance, r3 = C.nDistance;

    const x = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const y = (r1 * r1 - r3 * r3 - x * x + (x - i) * (x - i) + j * j) / (2 * j);

    const result = A.vPosition.add(ex.mul(x)).add(ey.mul(y));

    const zSquared = r1 * r1 - x * x - y * y;
    if (zSquared > 0) {
        const z = Math.sqrt(zSquared);
        const result1 = result.add(ez.mul(z));
        const result2 = result.sub(ez.mul(z));

        const rounded1 = result1.round(0.01), rounded2 = result2.round(0.01);
        if (rounded1.x !== rounded2.x || rounded1.y !== rounded2.y || rounded1.z !== rounded2.z) {
            return [rounded1, rounded2];
        }
        return [rounded1];
    }
    return [result.round(0.01)];
}

// Narrows two candidate positions down using a third fix. Returns an array of
// one or two positions.
function narrow(p1, p2, fix) {
    const dist1 = Math.abs(p1.sub(fix.vPosition).length() - fix.nDistance);
    const dist2 = Math.abs(p2.sub(fix.vPosition).length() - fix.nDistance);

    if (Math.abs(dist1 - dist2) < 0.01) return [p1, p2];
    if (dist1 < dist2) return [p1.round(0.01)];
    return [p2.round(0.01)];
}

// Tries to retrieve this computer or turtle's own location. Returns [x, y, z]
// or null. `timeout` defaults to 2 seconds; `debug` prints diagnostics.
async function locate(timeout, debug) {
    // Let command computers use their fourth-wall-breaking abilities.
    if (typeof commands !== "undefined" && commands) {
        return commands.getBlockPosition();
    }

    // Find a wireless modem.
    let modemSide = null;
    for (const side of rs.getSides()) {
        if ((await peripheral.getType(side))?.[0] === "modem" && await peripheral.call(side, "isWireless")) {
            modemSide = side;
            break;
        }
    }

    if (modemSide === null) {
        if (debug) print("No wireless modem attached");
        return null;
    }

    if (debug) print("Finding position...");

    const modem = await peripheral.wrap(modemSide);
    let closeChannel = false;
    if (!(await modem.isOpen(CHANNEL_GPS))) {
        await modem.open(CHANNEL_GPS);
        closeChannel = true;
    }

    await modem.transmit(CHANNEL_GPS, CHANNEL_GPS, "PING");

    const fixes = [];
    let pos1 = null, pos2 = null;
    const timer = os.startTimer(timeout ?? 2);

    while (true) {
        const [e, p1, p2, p3, p4, p5] = await pullEvents(["modem_message", "timer"]);
        if (e === "modem_message") {
            const side = p1, channel = p2, replyChannel = p3, message = p4, distance = p5;
            if (side === modemSide && channel === CHANNEL_GPS && replyChannel === CHANNEL_GPS && distance != null
                && type(message) === "table" && message.length === 3
                && tonumber(message[0]) !== null && tonumber(message[1]) !== null && tonumber(message[2]) !== null) {
                const fix = { vPosition: vector.new(message[0], message[1], message[2]), nDistance: distance };
                if (debug) print(fix.nDistance + " metres from " + fix.vPosition);

                if (fix.nDistance === 0) {
                    pos1 = fix.vPosition;
                    pos2 = null;
                } else {
                    // Insert (max three fixes); replace a nearby older fix instead of adding.
                    let insIndex = Math.min(2, fixes.length);
                    for (let idx = 0; idx < fixes.length; idx++) {
                        if (fixes[idx].vPosition.sub(fix.vPosition).length() < 1) {
                            insIndex = idx;
                            break;
                        }
                    }
                    fixes[insIndex] = fix;

                    if (fixes.length >= 3) {
                        const res = pos1 === null
                            ? trilaterate(fixes[0], fixes[1], fixes[2])
                            : narrow(pos1, pos2, fixes[2]);
                        pos1 = res?.[0] ?? null;
                        pos2 = res?.[1] ?? null;
                    }
                }
                if (pos1 && !pos2) break;
            }
        } else if (e === "timer" && p1 === timer) {
            break;
        }
    }

    if (closeChannel) await modem.close(CHANNEL_GPS);
    os.cancelTimer(timer);

    if (pos1 && pos2) {
        if (debug) {
            print("Ambiguous position");
            print(`Could be ${pos1.x},${pos1.y},${pos1.z} or ${pos2.x},${pos2.y},${pos2.z}`);
        }
        return null;
    } else if (pos1) {
        if (debug) print(`Position is ${pos1.x},${pos1.y},${pos1.z}`);
        return [pos1.x, pos1.y, pos1.z];
    }
    if (debug) print("Could not determine position");
    return null;
}

export default { CHANNEL_GPS, locate };
