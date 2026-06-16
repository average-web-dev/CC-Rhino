// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.core.apis;

import dan200.computercraft.api.filesystem.Mount;
import dan200.computercraft.api.filesystem.WritableMount;
import dan200.computercraft.api.scripting.*;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.api.peripheral.NotAttachedException;
import dan200.computercraft.api.peripheral.WorkMonitor;
import dan200.computercraft.core.computer.ComputerSide;
import dan200.computercraft.core.computer.GuardedContext;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.methods.PeripheralMethod;
import dan200.computercraft.core.metrics.Metrics;
import org.jspecify.annotations.Nullable;

import java.util.*;

/**
 * CC's "native" peripheral API. This is wrapped within CraftOS to provide a version which works with modems.
 *
 * @cc.module peripheral
 * @hidden
 */
public class PeripheralAPI implements IComputerAPI, IAPIEnvironment.IPeripheralChangeListener {
    private final class PeripheralWrapper extends ComputerAccess implements GuardedContext.Guard {
        private final String side;
        private final IPeripheral peripheral;

        private final String type;
        private final Set<String> additionalTypes;
        private final Map<String, PeripheralMethod> methodMap;
        private boolean attached = false;

        private @Nullable GuardedContext contextWrapper;

        PeripheralWrapper(IPeripheral peripheral, String side) {
            super(environment);
            this.side = side;
            this.peripheral = peripheral;

            type = Objects.requireNonNull(peripheral.getType(), "Peripheral type cannot be null");
            additionalTypes = peripheral.getAdditionalTypes();

            methodMap = peripheralMethods.getSelfMethods(peripheral);
        }

        private IPeripheral getPeripheral() {
            return peripheral;
        }

        private String getType() {
            return type;
        }

        private Set<String> getAdditionalTypes() {
            return additionalTypes;
        }

        private Collection<String> getMethods() {
            return methodMap.keySet();
        }

        private synchronized boolean isAttached() {
            return attached;
        }

        private synchronized void attach() {
            attached = true;
            peripheral.attach(this);
        }

        private void detach() {
            // Call detach
            peripheral.detach(this);

            synchronized (this) {
                // Unmount everything the detach function forgot to do
                unmountAll();
            }

            attached = false;
        }

        private MethodResult call(IContext context, String methodName, IArguments arguments) throws ScriptException {
            PeripheralMethod method;
            synchronized (this) {
                method = methodMap.get(methodName);
            }

            if (method == null) throw new ScriptException("No such method " + methodName);

            // Wrap the IContext. We try to reuse the previous context where possible to avoid allocations - this
            // should be pretty common as IMachine uses a constant context.
            var contextWrapper = this.contextWrapper;
            if (contextWrapper == null || !contextWrapper.wraps(context)) {
                contextWrapper = this.contextWrapper = new GuardedContext(context, this);
            }

            try (var ignored = environment.time(Metrics.PERIPHERAL_OPS)) {
                return method.apply(peripheral, contextWrapper, this, arguments);
            }
        }

        @Override
        public boolean checkValid() {
            return isAttached();
        }

        // IComputerAccess implementation

        @Nullable
        @Override
        public synchronized String mount(String desiredLoc, Mount mount, String driveName) {
            if (!attached) throw new NotAttachedException();
            return super.mount(desiredLoc, mount, driveName);
        }

        @Nullable
        @Override
        public synchronized String mountWritable(String desiredLoc, WritableMount mount, String driveName) {
            if (!attached) throw new NotAttachedException();
            return super.mountWritable(desiredLoc, mount, driveName);
        }

        @Override
        public synchronized void unmount(@Nullable String location) {
            if (!attached) throw new NotAttachedException();
            super.unmount(location);
        }

        @Override
        public int getID() {
            if (!attached) throw new NotAttachedException();
            return super.getID();
        }

        @Override
        public void queueEvent(String event, @Nullable Object... arguments) {
            if (!attached) throw new NotAttachedException();
            super.queueEvent(event, arguments);
        }

        @Override
        public String getAttachmentName() {
            if (!attached) throw new NotAttachedException();
            return side;
        }

        @Override
        public Map<String, IPeripheral> getAvailablePeripherals() {
            if (!attached) throw new NotAttachedException();

            Map<String, IPeripheral> peripherals = new HashMap<>();
            for (var wrapper : PeripheralAPI.this.peripherals) {
                if (wrapper != null && wrapper.isAttached()) {
                    peripherals.put(wrapper.getAttachmentName(), wrapper.getPeripheral());
                }
            }

            return Collections.unmodifiableMap(peripherals);
        }

        @Nullable
        @Override
        public IPeripheral getAvailablePeripheral(String name) {
            if (!attached) throw new NotAttachedException();

            for (var wrapper : peripherals) {
                if (wrapper != null && wrapper.isAttached() && wrapper.getAttachmentName().equals(name)) {
                    return wrapper.getPeripheral();
                }
            }
            return null;
        }

        @Override
        public WorkMonitor getMainThreadMonitor() {
            if (!attached) throw new NotAttachedException();
            return super.getMainThreadMonitor();
        }
    }

    private final IAPIEnvironment environment;
    private final MethodSupplier<PeripheralMethod> peripheralMethods;
    private final PeripheralWrapper[] peripherals = new PeripheralWrapper[6];
    private boolean running;

    public PeripheralAPI(IAPIEnvironment environment, MethodSupplier<PeripheralMethod> peripheralMethods) {
        this.environment = environment;
        this.peripheralMethods = peripheralMethods;
        this.environment.setPeripheralChangeListener(this);
        running = false;
    }

    // IPeripheralChangeListener

    @Override
    public void onPeripheralChanged(ComputerSide side, @Nullable IPeripheral newPeripheral) {
        synchronized (peripherals) {
            var index = side.ordinal();
            if (peripherals[index] != null) {
                // Queue a detachment
                final var wrapper = peripherals[index];
                if (wrapper.isAttached()) wrapper.detach();

                // Queue a detachment event
                environment.queueEvent("peripheral_detach", side.getName());
            }

            // Assign the new peripheral
            peripherals[index] = newPeripheral == null ? null
                : new PeripheralWrapper(newPeripheral, side.getName());

            if (peripherals[index] != null) {
                // Queue an attachment
                final var wrapper = peripherals[index];
                if (running && !wrapper.isAttached()) wrapper.attach();

                // Queue an attachment event
                environment.queueEvent("peripheral", side.getName());
            }
        }
    }

    @Override
    public String[] getNames() {
        return new String[]{ "peripheral" };
    }

    @Override
    public void startup() {
        synchronized (peripherals) {
            running = true;
            for (var i = 0; i < 6; i++) {
                var wrapper = peripherals[i];
                if (wrapper != null && !wrapper.isAttached()) wrapper.attach();
            }
        }
    }

    @Override
    public void shutdown() {
        synchronized (peripherals) {
            running = false;
            for (var i = 0; i < 6; i++) {
                var wrapper = peripherals[i];
                if (wrapper != null && wrapper.isAttached()) {
                    wrapper.detach();
                }
            }
        }
    }

    @ScriptFunction
    public final List<String> getSides() {
        return ComputerSide.NAMES;
    }

    @ScriptFunction
    public final boolean isPresent(String sideName) {
        var side = ComputerSide.valueOfInsensitive(sideName);
        if (side != null) {
            synchronized (peripherals) {
                var p = peripherals[side.ordinal()];
                if (p != null) return true;
            }
        }
        return false;
    }

    @ScriptFunction
    public final @Nullable List<String> getType(String sideName) {
        var side = ComputerSide.valueOfInsensitive(sideName);
        if (side == null) return null;

        synchronized (peripherals) {
            var p = peripherals[side.ordinal()];
            if (p == null) return null;
            // Return a single List (rendered as one JS array) rather than an Object[], which the bridge
            // would treat as multiple return values and collapse to a bare string when there is only one type.
            var types = new ArrayList<String>();
            types.add(p.getType());
            types.addAll(p.getAdditionalTypes());
            return types;
        }
    }

    @ScriptFunction
    public final @Nullable Object hasType(String sideName, String type) {
        var side = ComputerSide.valueOfInsensitive(sideName);
        if (side == null) return null;

        synchronized (peripherals) {
            var p = peripherals[side.ordinal()];
            if (p != null) {
                return p.getType().equals(type) || p.getAdditionalTypes().contains(type);
            }
        }
        return null;
    }

    @ScriptFunction
    public final @Nullable Object getMethods(String sideName) {
        var side = ComputerSide.valueOfInsensitive(sideName);
        if (side == null) return null;

        synchronized (peripherals) {
            var p = peripherals[side.ordinal()];
            if (p != null) return p.getMethods();
        }
        return null;
    }

    @ScriptFunction
    public final MethodResult call(IContext context, IArguments args) throws ScriptException {
        var side = ComputerSide.valueOfInsensitive(args.getString(0));
        var methodName = args.getString(1);
        var methodArgs = args.drop(2);

        if (side == null) throw new ScriptException("No peripheral attached");

        PeripheralWrapper p;
        synchronized (peripherals) {
            p = peripherals[side.ordinal()];
        }
        if (p == null) throw new ScriptException("No peripheral attached");

        try {
            return p.call(context, methodName, methodArgs).adjustError(1);
        } catch (ScriptException e) {
            // We increase the error level by one in order to shift the error level to where peripheral.call was
            // invoked. It would be possible to do it in script code, but would add significantly more overhead.
            if (e.getLevel() > 0) throw new FastScriptException(e.getMessage(), e.getLevel() + 1);
            throw e;
        }
    }
}
