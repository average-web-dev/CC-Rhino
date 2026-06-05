// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `http` — Node `http`/`https` style. `fetch()` is impossible (needs a Promise),
// so every request has a callback and a blocking `…Sync` variant.

interface RequestOptions {
    method?: string;
    body?: string | Buffer;
    headers?: Record<string, string>;
    binary?: boolean;
    /** Timeout in seconds. */
    timeout?: number;
    redirect?: boolean;
}

/** Response of an HTTP request. */
interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    ok: boolean;
    text(): string;
    json(): unknown;
    buffer(): Buffer;
}

/** A websocket connection (browser/`ws`-compatible, EventEmitter style). */
interface WebSocket {
    send(data: string | Buffer): void;
    on(event: "message", cb: (data: string | Buffer) => void): void;
    on(event: "open", cb: () => void): void;
    on(event: "close", cb: (reason?: string) => void): void;
    close(): void;
}

interface HttpModule {
    /** Blocking request. */
    requestSync(url: string, options?: RequestOptions): HttpResponse;
    /** Callback request. */
    request(options: RequestOptions & { url: string }, cb: Callback<HttpResponse>): void;

    /** Callback GET shortcut. */
    get(url: string, cb: Callback<HttpResponse>): void;
    /** Blocking GET. */
    getSync(url: string): HttpResponse;

    /** Blocking URL allow-list check. */
    checkURLSync(url: string): boolean;

    /** Open a websocket. Returns immediately; data arrives via events. */
    websocket(url: string, options?: { headers?: Record<string, string>; timeout?: number }): WebSocket;
}
