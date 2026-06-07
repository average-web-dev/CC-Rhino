// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.engine;

import dan200.computercraft.api.scripting.IComputerAPI;
import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.core.computer.GlobalEnvironment;
import dan200.computercraft.core.computer.TimeoutState;
import dan200.computercraft.core.filesystem.FileSystem;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.metrics.MetricsObserver;
import org.jspecify.annotations.Nullable;

/**
 * Arguments used to construct an {@link IMachine}.
 *
 * @param context      The context to execute main-thread tasks with.
 * @param metrics      A sink to submit metrics to.
 * @param timeout      The current timeout state. This should be used by the machine to interrupt its execution.
 * @param apis         APIs to expose to scripts. Each API is registered under all names in {@link IComputerAPI#getNames()}.
 * @param luaMethods   A {@link MethodSupplier} to find methods on returned values.
 * @param hostString   A {@linkplain GlobalEnvironment#getHostString() host string} to identify the current environment.
 * @param fileSystem   The computer's filesystem, used by {@code require()} to load modules. May be null in tests.
 * @param scheduleTick Called by the machine when it has internal pending work (microtasks, setImmediate) that must
 *                     run even if no CC event arrives. The implementation should enqueue a synthetic tick event so
 *                     the machine's {@code handleEvent} is called again soon. No-op for non-JS runtimes.
 * @see IMachine.Factory
 */
public record MachineEnvironment(
    IContext context,
    MetricsObserver metrics,
    TimeoutState timeout,
    Iterable<IComputerAPI> apis,
    MethodSupplier<ApiMethod> luaMethods,
    String hostString,
    @Nullable FileSystem fileSystem,
    Runnable scheduleTick
) {
}
