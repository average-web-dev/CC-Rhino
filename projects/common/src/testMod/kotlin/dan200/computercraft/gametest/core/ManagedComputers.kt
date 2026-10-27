// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.gametest.core

import dan200.computercraft.core.apis.SystemAPI
import dan200.computercraft.core.engine.IMachine
import dan200.computercraft.core.engine.JSMachine
import dan200.computercraft.core.engine.MachineEnvironment
import dan200.computercraft.gametest.api.thenOnComputer
import dan200.computercraft.mixin.gametest.GameTestInfoAccessor
import dan200.computercraft.shared.computer.core.ServerContext
import dan200.computercraft.test.core.computer.KotlinMachine
import dan200.computercraft.test.core.computer.ScriptTaskContext
import net.minecraft.gametest.framework.GameTestAssertException
import net.minecraft.gametest.framework.GameTestAssertPosException
import net.minecraft.gametest.framework.GameTestInfo
import net.minecraft.gametest.framework.GameTestSequence
import org.slf4j.LoggerFactory
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.*
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.atomic.AtomicReference

/**
 * Provides a custom [IMachine] which allows computers to run Kotlin or JS code, depending on their ID.
 *
 * This allows writing game tests which consume script APIs, without having the overhead of starting a new computer for
 * each test.
 *
 * @see GameTestSequence.thenOnComputer
 */
object ManagedComputers : IMachine.Factory {
    private val LOGGER = LoggerFactory.getLogger(ManagedComputers::class.java)
    private val computers: MutableMap<String, Queue<suspend ScriptTaskContext.() -> Unit>> = mutableMapOf()

    internal fun reset() {
        computers.clear()
    }

    internal fun enqueue(test: GameTestInfo, label: String, task: suspend ScriptTaskContext.() -> Unit): Monitor {
        val monitor = Monitor(test, label)
        computers.computeIfAbsent(label) { ConcurrentLinkedDeque() }.add {
            try {
                LOGGER.info("Running $label")
                task()
                monitor.result.set(Result.success(Unit))
            } catch (e: Throwable) {
                if (e !is AssertionError && e !is CancellationException) LOGGER.error("Computer $label failed", e)
                monitor.result.set(Result.failure(e))
                throw e
            } finally {
                LOGGER.info("Finished $label")
            }
        }

        ServerContext.get(test.level.server).registry().computers
            .firstOrNull { it.label == label }?.queueEvent("test_wakeup")

        return monitor
    }

    override fun create(environment: MachineEnvironment, bios: InputStream): IMachine {
        val system = environment.apis.asSequence().filterIsInstance<SystemAPI>().first()
        val id = system.computerID
        val label = system.computerLabel
        return when {
            id != 1 -> JSMachine(environment, testBios())

            label != null -> ManagedMachine(environment, label)

            else -> {
                LOGGER.error("Kotlin machine must have a label")
                JSMachine(environment, testBios())
            }
        }
    }

    private fun testBios(): InputStream = ByteArrayInputStream(TEST_BIOS.toByteArray(Charsets.UTF_8))

    /**
     * A minimal bios used by every JS computer in the test world, in place of the real ROM boot sequence (see
     * `ComputerBootstrap` for the unit-test equivalent).
     *
     * Like the real bios it installs the `process` and `console` globals (from the ROM), exposes the `test` API as a
     * global (extended with the assertion helpers which were previously declared in `rom/autorun/cctest.lua`), and
     * then runs `/startup.js` if present. The startup script
     * (see `data/cctest/computer/startup.js`) runs `/tests/<label>.js` and reports back through [TestAPI].
     */
    private val TEST_BIOS = """
        // Like the real bios: install the `process` and `console` globals (and the terminal driver) first.
        require('/rom/lib/internal/globals');

        (function () {
            var fs = require('fs');
            var native = require('test');

            function describe(value) {
                return typeof value === 'string' ? JSON.stringify(value) : String(value);
            }

            var test = {
                ok: function (marker) { native.ok(marker); },
                fail: function (message) { native.fail(String(message)); },
                log: function (message) { native.log(String(message)); },
                queueEvent: function (event) { native.queueEvent(String(event)); },
                runFaultyTurtleCommand: function (message) { return native.runFaultyTurtleCommand(String(message)); },
                assert: function (value, message) {
                    if (value) return value;
                    test.fail(message !== undefined ? message : 'Assertion failed');
                },
                eq: function (expected, actual, message) {
                    if (expected === actual) return;
                    var text = 'Assertion failed:\nExpected ' + describe(expected) + ',\ngot ' + describe(actual);
                    test.fail(message !== undefined ? message + ' - ' + text : text);
                },
                neq: function (expected, actual, message) {
                    if (expected !== actual) return;
                    var text = 'Assertion failed:\nExpected something different to ' + describe(expected);
                    test.fail(message !== undefined ? message + ' - ' + text : text);
                },
            };
            globalThis.test = test;

            if (fs.existsSync('/startup.js')) require('/startup.js');
        })();
    """.trimIndent()

    private class ManagedMachine(environment: MachineEnvironment, private val label: String) :
        KotlinMachine(environment) {
        override fun getTask(): (suspend KotlinMachine.() -> Unit)? = computers[label]?.poll()
    }

    class Monitor(private val test: GameTestInfo, private val label: String) {
        internal val result = AtomicReference<Result<Unit>>()

        val isFinished
            get() = result.get() != null

        fun check() {
            val result = result.get() ?: fail("Computer $label did not finish")
            val error = result.exceptionOrNull()
            if (error != null) fail(error.message ?: error.toString())
        }

        private fun fail(message: String): Nothing {
            val computer =
                ServerContext.get(test.level.server).registry().computers.firstOrNull { it.label == label }
            if (computer == null) {
                throw GameTestAssertException(message)
            } else {
                val pos = computer.position
                val relativePos = pos.subtract(test.structureBlockPos!!)
                throw GameTestAssertPosException(message, pos, relativePos, (test as GameTestInfoAccessor).`computercraft$getTick`())
            }
        }
    }
}
