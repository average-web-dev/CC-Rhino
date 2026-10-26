// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.gametest

import dan200.computercraft.gametest.api.sequence
import dan200.computercraft.gametest.api.thenComputerOk
import net.minecraft.gametest.framework.GameTestHelper

class CraftOs_Test {
    /**
     * Sends a rednet message to another a computer and back again.
     *
     * Disabled: the JS ROM has no `rednet` library yet (average-web-dev/CC-Rhino#5). Re-enable by restoring the
     * annotation below once it exists.
     */
    @Suppress("unused")
    // @GameTest(timeoutTicks = Timeouts.COMPUTER_TIMEOUT)
    fun Sends_basic_rednet_messages(context: GameTestHelper) = context.sequence { thenComputerOk("main") }
}
