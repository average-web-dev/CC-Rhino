// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core;

import com.google.errorprone.annotations.CheckReturnValue;
import dan200.computercraft.core.asm.GenericMethod;
import dan200.computercraft.core.asm.ApiMethodSupplier;
import dan200.computercraft.core.asm.PeripheralMethodSupplier;
import dan200.computercraft.core.computer.GlobalEnvironment;
import dan200.computercraft.core.computer.computerthread.ComputerScheduler;
import dan200.computercraft.core.computer.computerthread.ComputerThread;
import dan200.computercraft.core.computer.mainthread.MainThreadScheduler;
import dan200.computercraft.core.computer.mainthread.NoWorkMainThreadScheduler;
import dan200.computercraft.core.engine.JSMachine;
import dan200.computercraft.core.engine.IMachine;
import dan200.computercraft.core.engine.MachineEnvironment;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.methods.PeripheralMethod;
import org.jspecify.annotations.Nullable;

import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * The global context under which computers run.
 */
public final class ComputerContext {
    private final GlobalEnvironment globalEnvironment;
    private final ComputerScheduler computerScheduler;
    private final MainThreadScheduler mainThreadScheduler;
    private final IMachine.Factory machineFactory;
    private final MethodSupplier<ApiMethod> scriptMethods;
    private final MethodSupplier<PeripheralMethod> peripheralMethods;

    private ComputerContext(
        GlobalEnvironment globalEnvironment, ComputerScheduler computerScheduler,
        MainThreadScheduler mainThreadScheduler, IMachine.Factory machineFactory,
        MethodSupplier<ApiMethod> scriptMethods,
        MethodSupplier<PeripheralMethod> peripheralMethods
    ) {
        this.globalEnvironment = globalEnvironment;
        this.computerScheduler = computerScheduler;
        this.mainThreadScheduler = mainThreadScheduler;
        this.machineFactory = machineFactory;
        this.scriptMethods = scriptMethods;
        this.peripheralMethods = peripheralMethods;
    }

    /**
     * The global environment.
     *
     * @return The current global environment.
     */
    public GlobalEnvironment globalEnvironment() {
        return globalEnvironment;
    }

    /**
     * The {@link ComputerThread} instance under which computers are run. This is closed when the context is closed, and
     * so should be unique per-context.
     *
     * @return The current computer thread manager.
     */
    public ComputerScheduler computerScheduler() {
        return computerScheduler;
    }

    /**
     * The {@link MainThreadScheduler} instance used to run main-thread tasks.
     *
     * @return The current main thread scheduler.
     */
    public MainThreadScheduler mainThreadScheduler() {
        return mainThreadScheduler;
    }

    /**
     * The factory to create new machines.
     *
     * @return The current machine factory.
     */
    public IMachine.Factory machineFactory() {
        return machineFactory;
    }

    /**
     * Get the {@link MethodSupplier} used to find methods on values.
     *
     * @return The {@link ApiMethod} method supplier.
     * @see MachineEnvironment#scriptMethods()
     */
    public MethodSupplier<ApiMethod> scriptMethods() {
        return scriptMethods;
    }

    /**
     * Get the {@link MethodSupplier} used to find methods on peripherals.
     *
     * @return The {@link PeripheralMethod} method supplier.
     */
    public MethodSupplier<PeripheralMethod> peripheralMethods() {
        return peripheralMethods;
    }

    /**
     * Close the current {@link ComputerContext}, disposing of any resources inside.
     *
     * @param timeout The maximum time to wait.
     * @param unit    The unit {@code timeout} is in.
     * @return Whether the context was successfully shut down.
     * @throws InterruptedException If interrupted while waiting.
     */
    @CheckReturnValue
    public boolean close(long timeout, TimeUnit unit) throws InterruptedException {
        return computerScheduler().stop(timeout, unit);
    }

    /**
     * Close the current {@link ComputerContext}, disposing of any resources inside.
     *
     * @param timeout The maximum time to wait.
     * @param unit    The unit {@code timeout} is in.
     * @throws IllegalStateException If the computer thread was not shut down in time.
     * @throws InterruptedException  If interrupted while waiting.
     */
    public void ensureClosed(long timeout, TimeUnit unit) throws InterruptedException {
        if (!computerScheduler().stop(timeout, unit)) {
            throw new IllegalStateException("Failed to shutdown ComputerContext in time.");
        }
    }

    /**
     * Create a new {@linkplain Builder builder} for a computer context.
     *
     * @param environment The {@linkplain ComputerContext#globalEnvironment() global environment} for this context.
     * @return The builder for a new context.
     */
    public static Builder builder(GlobalEnvironment environment) {
        return new Builder(environment);
    }

    /**
     * A builder for a {@link ComputerContext}.
     *
     * @see ComputerContext#builder(GlobalEnvironment)
     */
    public static class Builder {
        private final GlobalEnvironment environment;
        private @Nullable ComputerScheduler computerScheduler = null;
        private @Nullable MainThreadScheduler mainThreadScheduler;
        private IMachine.@Nullable Factory machineFactory;
        private @Nullable List<GenericMethod> genericMethods;

        Builder(GlobalEnvironment environment) {
            this.environment = environment;
        }

        /**
         * Set the {@link #computerScheduler()} to use {@link ComputerThread} with a given number of threads.
         *
         * @param threads The number of threads to use.
         * @return {@code this}, for chaining
         * @see ComputerContext#computerScheduler()
         */
        public Builder computerThreads(int threads) {
            if (threads < 1) throw new IllegalArgumentException("Threads must be >= 1");
            return computerScheduler(new ComputerThread(threads));
        }

        /**
         * Set the {@link ComputerScheduler} for this context.
         *
         * @param scheduler The computer thread scheduler.
         * @return {@code this}, for chaining
         * @see ComputerContext#mainThreadScheduler()
         */
        public Builder computerScheduler(ComputerScheduler scheduler) {
            Objects.requireNonNull(scheduler);
            if (computerScheduler != null) throw new IllegalStateException("Computer scheduler already specified");
            computerScheduler = scheduler;
            return this;
        }

        /**
         * Set the {@link MainThreadScheduler} for this context.
         *
         * @param scheduler The main thread scheduler.
         * @return {@code this}, for chaining
         * @see ComputerContext#mainThreadScheduler()
         */
        public Builder mainThreadScheduler(MainThreadScheduler scheduler) {
            Objects.requireNonNull(scheduler);
            if (mainThreadScheduler != null) throw new IllegalStateException("Main-thread scheduler already specified");
            mainThreadScheduler = scheduler;
            return this;
        }

        /**
         * Set the {@link IMachine.Factory} for this context.
         *
         * @param factory The machine factory.
         * @return {@code this}, for chaining
         * @see ComputerContext#machineFactory()
         */
        public Builder machineFactory(IMachine.Factory factory) {
            Objects.requireNonNull(factory);
            if (machineFactory != null) throw new IllegalStateException("Main-thread scheduler already specified");
            machineFactory = factory;
            return this;
        }

        /**
         * Set the set of {@link GenericMethod}s used by the {@linkplain MethodSupplier method suppliers}.
         *
         * @param genericMethods A list of API factories.
         * @return {@code this}, for chaining
         * @see ComputerContext#scriptMethods()
         * @see ComputerContext#peripheralMethods()
         */
        public Builder genericMethods(Collection<GenericMethod> genericMethods) {
            Objects.requireNonNull(genericMethods);
            if (this.genericMethods != null) throw new IllegalStateException("Main-thread scheduler already specified");
            this.genericMethods = List.copyOf(genericMethods);
            return this;
        }

        /**
         * Create a new {@link ComputerContext}.
         *
         * @return The newly created context.
         */
        public ComputerContext build() {
            return new ComputerContext(
                environment,
                computerScheduler == null ? new ComputerThread(1) : computerScheduler,
                mainThreadScheduler == null ? new NoWorkMainThreadScheduler() : mainThreadScheduler,
                machineFactory == null ? JSMachine::new : machineFactory,
                ApiMethodSupplier.create(genericMethods == null ? List.of() : genericMethods),
                PeripheralMethodSupplier.create(genericMethods == null ? List.of() : genericMethods)
            );
        }
    }
}
