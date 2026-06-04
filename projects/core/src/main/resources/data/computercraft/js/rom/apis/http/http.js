// SPDX-FileCopyrightText: 2017 Daniel Ratcliffe
//
// SPDX-License-Identifier: LicenseRef-CCPL

// Make HTTP requests, sending and receiving data to a remote web server —
// mirrors the CC Lua http API. The native http primitives queue events
// (http_success/http_failure/http_check/websocket_*); the synchronous wrappers
// below await those via the os EventEmitter.
//
// Multiple return values are arrays: e.g. a failed request returns
// [null, errorMessage, failingResponse?]; checkURL returns [ok, reason].

const native = http;
const nativeHTTPRequest = http.request;
const nativeCheckURL = http.checkURL;
const nativeWebsocket = http.websocket;

const METHODS = new Set(["GET", "POST", "HEAD", "OPTIONS", "PUT", "DELETE", "PATCH", "TRACE"]);

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

// Native primitives may return a single value or [ok, err]; normalise to [ok, err].
function splitOk(res) {
    return Array.isArray(res) ? [res[0], res[1]] : [res, undefined];
}

function expect(i, v, ...types) {
    const t = type(v);
    if (!types.includes(t)) throw new Error(`bad argument #${i} (${types.join(" or ")} expected, got ${t})`);
}

function checkKey(options, key, ty, opt) {
    const value = options[key];
    const valueTy = type(value);
    if ((value !== undefined && value !== null || !opt) && valueTy !== ty) {
        throw new Error(`bad field '${key}' (${ty} expected, got ${valueTy})`);
    }
}

function checkRequestOptions(options, body) {
    checkKey(options, "url", "string");
    if (body === false) checkKey(options, "body", "nil");
    else checkKey(options, "body", "string", !body);
    checkKey(options, "headers", "table", true);
    checkKey(options, "method", "string", true);
    checkKey(options, "redirect", "boolean", true);
    checkKey(options, "timeout", "number", true);
    if (options.method && !METHODS.has(options.method)) throw new Error("Unsupported HTTP method");
}

function checkWebsocketOptions(options) {
    checkKey(options, "url", "string");
    checkKey(options, "headers", "table", true);
    checkKey(options, "timeout", "number", true);
}

async function wrapRequest(url, ...args) {
    const [ok, err] = splitOk(nativeHTTPRequest(...args));
    if (ok) {
        while (true) {
            const [event, p1, p2, p3] = await pullEvents(["http_success", "http_failure"]);
            if (event === "http_success" && p1 === url) return p2;
            if (event === "http_failure" && p1 === url) return [null, p2, p3];
        }
    }
    return [null, err];
}

// Make an HTTP GET request. Returns the response handle, or [null, err, resp?].
async function get(url, headers, binary) {
    if (type(url) === "table") {
        checkRequestOptions(url, false);
        return wrapRequest(url.url, url);
    }
    expect(1, url, "string");
    expect(2, headers, "table", "nil");
    expect(3, binary, "boolean", "nil");
    return wrapRequest(url, url, null, headers, binary);
}

// Make an HTTP POST request. Returns the response handle, or [null, err, resp?].
async function post(url, body, headers, binary) {
    if (type(url) === "table") {
        checkRequestOptions(url, true);
        return wrapRequest(url.url, url);
    }
    expect(1, url, "string");
    expect(2, body, "string");
    expect(3, headers, "table", "nil");
    expect(4, binary, "boolean", "nil");
    return wrapRequest(url, url, body, headers, binary);
}

// Asynchronously make an HTTP request, queuing http_success/http_failure.
// Returns [ok, err] (legacy, undocumented).
function request(url, body, headers, binary) {
    let actualUrl;
    if (type(url) === "table") {
        checkRequestOptions(url);
        actualUrl = url.url;
    } else {
        expect(1, url, "string");
        expect(2, body, "string", "nil");
        expect(3, headers, "table", "nil");
        expect(4, binary, "boolean", "nil");
        actualUrl = url;
    }

    const [ok, err] = splitOk(nativeHTTPRequest(url, body, headers, binary));
    if (!ok) os.queueEvent("http_failure", actualUrl, err);
    return [ok, err];
}

// Asynchronously determine whether a URL can be requested.
const checkURLAsync = nativeCheckURL;

// Determine whether a URL can be requested. Returns [ok, reason].
async function checkURL(url) {
    expect(1, url, "string");
    const [ok, err] = splitOk(nativeCheckURL(url));
    if (!ok) return [ok, err];
    while (true) {
        const [, u, ok2, err2] = await pullEvents(["http_check"]);
        if (u === url) return [ok2, err2];
    }
}

// Asynchronously open a websocket, queuing websocket_success/websocket_failure.
// Returns [ok, err] (legacy, undocumented).
function websocketAsync(url, headers) {
    let actualUrl;
    if (type(url) === "table") {
        checkWebsocketOptions(url);
        actualUrl = url.url;
    } else {
        expect(1, url, "string");
        expect(2, headers, "table", "nil");
        actualUrl = url;
    }

    const [ok, err] = splitOk(nativeWebsocket(url, headers));
    if (!ok) os.queueEvent("websocket_failure", actualUrl, err);
    return [ok, err];
}

// Open a websocket. Returns the websocket handle, or [false, err].
async function websocket(url, headers) {
    let actualUrl;
    if (type(url) === "table") {
        checkWebsocketOptions(url);
        actualUrl = url.url;
    } else {
        expect(1, url, "string");
        expect(2, headers, "table", "nil");
        actualUrl = url;
    }

    const [ok, err] = splitOk(nativeWebsocket(url, headers));
    if (!ok) return [false, err];

    while (true) {
        const [event, u, param] = await pullEvents(["websocket_success", "websocket_failure"]);
        if (event === "websocket_success" && u === actualUrl) return param;
        if (event === "websocket_failure" && u === actualUrl) return [false, param];
    }
}

export default {
    get, post, request, checkURL, checkURLAsync, websocket, websocketAsync,
};
