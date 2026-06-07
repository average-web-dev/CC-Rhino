// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.test.core.computer

import dan200.computercraft.api.scripting.IComputerAPI
import dan200.computercraft.api.scripting.IContext
import dan200.computercraft.api.scripting.MethodResult
import dan200.computercraft.api.scripting.ObjectArguments
import dan200.computercraft.core.apis.SystemAPI
import dan200.computercraft.core.apis.PeripheralAPI
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration

/**
 * The context for tasks which consume Lua objects.
 *
 * This provides helpers for converting CC's callback-based code into a more direct style based on Kotlin coroutines.
 */
interface ScriptTaskContext {
    /** The current Lua context, to be passed to method calls. */
    val context: IContext

    /** Get a registered API. */
    fun <T : IComputerAPI> getApi(api: Class<T>): T

    /** Pull a Lua event */
    suspend fun pullEvent(event: String? = null): Array<out Any?>

    suspend fun pullEventOrTimeout(timeout: Duration, event: String? = null): Array<out Any?>? =
        withTimeoutOrNull(timeout) { pullEvent(event) }

    /** Resolve a [MethodResult] until completion, returning the resulting values. */
    suspend fun MethodResult.await(): Array<out Any?>? {
        var result = this
        while (true) {
            val callback = result.callback
            val values = result.result

            if (callback == null) return values

            val filter = if (values == null) null else values[0] as String?
            result = callback.resume(pullEvent(filter))
        }
    }

    /** Call a peripheral method. */
    suspend fun ScriptTaskContext.callPeripheral(name: String, method: String, vararg args: Any?): Array<out Any?>? =
        getApi<PeripheralAPI>().call(context, ObjectArguments(name, method, *args)).await()

    /**
     * Sleep for the given duration. This uses the internal computer clock, so won't be accurate.
     */
    suspend fun ScriptTaskContext.sleep(duration: Duration) {
        val timer = getApi<SystemAPI>().startTimer(duration.inWholeMilliseconds / 1000.0)
        while (true) {
            val event = pullEvent("timer")
            if (event[0] == "timer" && event[1] is Number && (event[1] as Number).toInt() == timer) {
                return
            }
        }
    }
}

/** Get a registered API. */
inline fun <reified T : IComputerAPI> ScriptTaskContext.getApi(): T = getApi(T::class.java)

abstract class AbstractLuaTaskContext : ScriptTaskContext, AutoCloseable {
    private val isReceiving = AtomicBoolean(false)
    private val eventStream: Channel<Event> = Channel(Channel.UNLIMITED)
    private val apis = mutableMapOf<Class<out IComputerAPI>, IComputerAPI>()

    protected fun addApi(api: IComputerAPI) {
        apis[api.javaClass] = api
    }

    protected val hasEventListeners
        get() = isReceiving.get()

    protected fun queueEvent(eventName: String?, arguments: Array<out Any?>?) {
        eventStream.trySend(Event(eventName, arguments)).getOrThrow()
    }

    override fun close() {
        eventStream.close()
    }

    final override fun <T : IComputerAPI> getApi(api: Class<T>): T =
        api.cast(apis[api] ?: throw IllegalStateException("No API of type ${api.name}"))

    final override suspend fun pullEvent(event: String?): Array<out Any?> {
        if (!isReceiving.compareAndSet(false, true)) {
            throw IllegalStateException("Multiple listeners not currently supported")
        }

        try {
            while (true) {
                val received = eventStream.receive()
                if (event == null || received.name == event) {
                    return received.full
                }
            }
        } catch (e: ClosedReceiveChannelException) {
            throw CancellationException(e)
        } finally {
            isReceiving.set(false)
        }
    }

    private class Event(val name: String?, val args: Array<out Any?>?) {
        val full: Array<out Any?>
            get() = if (args == null) arrayOf(name) else arrayOf(name, *args)
    }
}
