// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.test.core.computer

import dan200.computercraft.api.scripting.IComputerAPI
import dan200.computercraft.api.scripting.IContext
import dan200.computercraft.api.scripting.ScriptException
import dan200.computercraft.core.apis.IAPIEnvironment
import dan200.computercraft.test.core.apis.BasicApiEnvironment
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

class ScriptTaskRunner : AbstractLuaTaskContext() {
    private val apis = mutableListOf<IComputerAPI>()

    val environment: IAPIEnvironment = object : BasicApiEnvironment(BasicEnvironment()) {
        override fun queueEvent(event: String?, vararg args: Any?) = this@ScriptTaskRunner.queueEvent(event, args)
    }

    override val context =
        IContext { throw ScriptException("Cannot queue main thread task") }

    fun <T : IComputerAPI> addApi(api: T): T {
        super.addApi(api)
        apis.add(api)
        api.startup()
        return api
    }

    override fun close() {
        super.close()
        environment.shutdown()
    }

    companion object {
        fun runTest(timeout: Duration = 5.seconds, fn: suspend ScriptTaskRunner.() -> Unit) {
            runBlocking {
                withTimeout(timeout) {
                    ScriptTaskRunner().use { fn(it) }
                }
            }
        }
    }
}
