// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.core.apis;

import dan200.computercraft.api.scripting.*;
import dan200.computercraft.core.CoreConfig;
import dan200.computercraft.core.apis.http.*;
import dan200.computercraft.core.apis.http.request.HttpRequest;
import dan200.computercraft.core.apis.http.websocket.Websocket;
import dan200.computercraft.core.apis.http.websocket.WebsocketClient;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpHeaders;
import io.netty.handler.codec.http.HttpMethod;

import java.nio.ByteBuffer;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

import static dan200.computercraft.core.util.ArgumentHelpers.assertBetween;

/**
 * Placeholder description, please ignore.
 *
 * @cc.module http
 * @hidden
 */
public class HTTPAPI implements IComputerAPI {
    private static final double DEFAULT_TIMEOUT = 30;
    private static final double MAX_TIMEOUT = 60;

    private final IAPIEnvironment apiEnvironment;

    private final ResourceGroup<CheckUrl> checkUrls = new ResourceGroup<>(() -> ResourceGroup.DEFAULT_LIMIT);
    private final ResourceGroup<HttpRequest> requests = new ResourceQueue<>(() -> CoreConfig.httpMaxRequests);
    private final ResourceGroup<Websocket> websockets = new ResourceGroup<>(() -> CoreConfig.httpMaxWebsockets);

    public HTTPAPI(IAPIEnvironment environment) {
        apiEnvironment = environment;
    }

    @Override
    public String[] getNames() {
        return new String[]{ "http" };
    }

    @Override
    public void startup() {
        checkUrls.startup();
        requests.startup();
        websockets.startup();
    }

    @Override
    public void shutdown() {
        checkUrls.shutdown();
        requests.shutdown();
        websockets.shutdown();
    }

    @Override
    public void update() {
        // It's rather ugly to run this here, but we need to clean up
        // resources as often as possible to reduce blocking.
        Resource.cleanup();
    }

    @ScriptFunction
    public final Result request(IArguments args) throws ScriptException {
        String address, requestMethod;
        ByteBuffer postBody;
        Map<?, ?> headerTable;
        boolean binary, redirect;
        Optional<Double> timeoutArg;

        if (args.get(0) instanceof Map) {
            var options = new ObjectTable(args.getTable(0));
            address = options.getString("url");
            postBody = options.optString("body").map(ScriptValues::encode).orElse(null);
            headerTable = options.optTable("headers").orElse(Map.of());
            binary = options.optBoolean("binary").orElse(false);
            requestMethod = options.optString("method").orElse(null);
            redirect = options.optBoolean("redirect").orElse(true);
            timeoutArg = options.optFiniteDouble("timeout");
        } else {
            // Get URL and post information
            address = args.getString(0);
            postBody = args.optBytes(1).orElse(null);
            headerTable = args.optTable(2, Map.of());
            binary = args.optBoolean(3, false);
            requestMethod = null;
            redirect = true;
            timeoutArg = Optional.empty();
        }

        var headers = getHeaders(headerTable);
        var timeout = getTimeout(timeoutArg);

        HttpMethod httpMethod;
        if (requestMethod == null) {
            httpMethod = postBody == null ? HttpMethod.GET : HttpMethod.POST;
        } else {
            httpMethod = HttpMethod.valueOf(requestMethod.toUpperCase(Locale.ROOT));
            if (httpMethod == null || requestMethod.equalsIgnoreCase("CONNECT")) {
                throw new ScriptException("Unsupported HTTP method");
            }
        }

        try {
            var uri = HttpRequest.checkUri(address);
            var request = new HttpRequest(requests, apiEnvironment, address, postBody, headers, binary, redirect, timeout);

            // Make the request
            if (!request.queue(r -> r.request(uri, httpMethod))) {
                throw new ScriptException("Too many ongoing HTTP requests");
            }

            return Result.succeed();
        } catch (HTTPRequestException e) {
            return Result.fail(e.getMessage());
        }
    }

    @ScriptFunction
    public final Result checkURL(String address) throws ScriptException {
        try {
            var uri = HttpRequest.checkUri(address);
            if (!new CheckUrl(checkUrls, apiEnvironment, address, uri).queue(CheckUrl::run)) {
                throw new ScriptException("Too many ongoing checkUrl calls");
            }

            return Result.succeed();
        } catch (HTTPRequestException e) {
            return Result.fail(e.getMessage());
        }
    }

    @ScriptFunction
    public final Result websocket(IArguments args) throws ScriptException {
        if (!CoreConfig.httpWebsocketEnabled) {
            throw new ScriptException("Websocket connections are disabled");
        }

        String address;
        Map<?, ?> headerTable;
        Optional<Double> timeoutArg;

        if (args.get(0) instanceof Map) {
            var options = new ObjectTable(args.getTableUnsafe(0));
            address = options.getString("url");
            headerTable = options.optTable("headers").orElse(Map.of());
            timeoutArg = options.optFiniteDouble("timeout");
        } else {
            address = args.getString(0);
            headerTable = args.optTable(1, Map.of());
            timeoutArg = Optional.empty();
        }

        var headers = getHeaders(headerTable);
        var timeout = getTimeout(timeoutArg);

        try {
            var uri = WebsocketClient.parseUri(address);
            if (!new Websocket(websockets, apiEnvironment, uri, address, headers, timeout).queue(Websocket::connect)) {
                throw new ScriptException("Too many websockets already open");
            }

            return Result.succeed();
        } catch (HTTPRequestException e) {
            return Result.fail(e.getMessage());
        }
    }

    private HttpHeaders getHeaders(Map<?, ?> headerTable) throws ScriptException {
        HttpHeaders headers = new DefaultHttpHeaders();
        for (Map.Entry<?, ?> entry : headerTable.entrySet()) {
            var value = entry.getValue();
            if (entry.getKey() instanceof String && value instanceof String) {
                try {
                    headers.add((String) entry.getKey(), value);
                } catch (IllegalArgumentException e) {
                    throw new ScriptException(e.getMessage());
                }
            }
        }

        if (!headers.contains(HttpHeaderNames.USER_AGENT)) {
            headers.set(HttpHeaderNames.USER_AGENT, apiEnvironment.getGlobalEnvironment().getUserAgent());
        }
        return headers;
    }

    /**
     * Parse the timeout value, asserting it is in range.
     *
     * @param timeoutArg The (optional) timeout, in seconds.
     * @return The parsed timeout value, in milliseconds.
     * @throws ScriptException If the timeout is in-range.
     */
    private static int getTimeout(Optional<Double> timeoutArg) throws ScriptException {
        double timeout = timeoutArg.orElse(DEFAULT_TIMEOUT);
        assertBetween(timeout, 0, MAX_TIMEOUT, "timeout out of range (%s)");
        return (int) (timeout * 1000);
    }
}
