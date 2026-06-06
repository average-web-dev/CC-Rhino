// SPDX-FileCopyrightText: 2024 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.computer;

import dan200.computercraft.api.scripting.IComputerAPI;

/**
 * Hooks for managing the lifecycle of an API. This allows adding additional logic to an API's {@link IComputerAPI#startup()}
 * and {@link IComputerAPI#shutdown()} methods.
 *
 * @see IComputerAPI
 * @see Computer#addApi(IComputerAPI, ApiLifecycle)
 */
public interface ApiLifecycle {
    /**
     * Called before the API's {@link IComputerAPI#startup()} method, may be used to set up resources.
     */
    default void startup() {
    }

    /**
     * Called after the API's {@link IComputerAPI#shutdown()} method, may be used to tear down resources.
     */
    default void shutdown() {
    }
}
