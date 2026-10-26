// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import org.mozilla.javascript.*;

/**
 * Lets a parked native call fail at its JS call site.
 *
 * <p>Rhino can only resume a continuation with a value, not with an exception. Every {@link JSMethodBridge} is
 * therefore wrapped in a small interpreted JS function: when a blocking call completes with an error, the
 * {@link EventLoop} resumes the continuation with a private failure marker (see {@link #failure}), and the wrapper
 * throws the carried {@code Error} from the original call site, where JS {@code try/catch} can handle it.
 *
 * <p>The wrapper must be interpreted JS (not Java) so the continuation is captured in — and resumed into — its
 * frame.
 */
final class JSCallShim {
    private static final String SHIM_JS = """
        (function () {
            function Failure() {}
            function wrap(fn) {
                return function () {
                    var r = fn.apply(this, arguments);
                    if (r instanceof Failure) throw r.error;
                    return r;
                };
            }
            return [wrap, Failure.prototype];
        })()
        """;

    private final Function wrap;
    private final Scriptable failureProto;

    JSCallShim(Context cx, Scriptable scope) {
        var parts = (Scriptable) cx.evaluateString(scope, SHIM_JS, "call-shim.js", 1, null);
        wrap = (Function) parts.get(0, parts);
        failureProto = (Scriptable) parts.get(1, parts);
    }

    /** Wrap a native function so that a failure marker it is resumed with is thrown at the call site. */
    Object wrap(Context cx, Scriptable scope, BaseFunction fn) {
        // Give the native function Function.prototype so the wrapper can forward arguments with fn.apply().
        ScriptRuntime.setFunctionProtoAndParent(fn, cx, scope);
        return wrap.call(cx, scope, scope, new Object[]{ fn });
    }

    /** Build the value to resume a continuation with so that its call site throws {@code new Error(message)}. */
    Scriptable failure(Context cx, Scriptable scope, String message) {
        return failureWith(cx, scope, cx.newObject(scope, "Error", new Object[]{ message }));
    }

    /** Build the value to resume a continuation with so that its call site throws {@code error} (any JS value). */
    Scriptable failureWith(Context cx, Scriptable scope, Object error) {
        var failure = cx.newObject(scope);
        failure.setPrototype(failureProto);
        ScriptableObject.putProperty(failure, "error", error);
        return failure;
    }
}
