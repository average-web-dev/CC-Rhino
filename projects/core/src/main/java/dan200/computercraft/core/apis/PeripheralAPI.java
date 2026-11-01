// Copyright Daniel Ratcliffe, 2011-2022. Do not distribute without permission.
//
// SPDX-License-Identifier: LicenseRef-CCPL

package dan200.computercraft.core.apis;

import dan200.computercraft.api.filesystem.Mount;
import dan200.computercraft.api.filesystem.WritableMount;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.api.peripheral.NotAttachedException;
import dan200.computercraft.api.peripheral.WorkMonitor;
import dan200.computercraft.api.scripting.*;
import dan200.computercraft.core.apis.events.CoreEvents;
import dan200.computercraft.core.computer.ComputerSide;
import dan200.computercraft.core.computer.GuardedContext;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.methods.PeripheralMethod;
import dan200.computercraft.core.metrics.Metrics;
import org.jspecify.annotations.Nullable;

import java.util.*;

/**
 * The devices (peripherals) of a computer, by id: those on its sides and those reached through a network (a wired
 * modem's remote peripherals, attached with {@link IComputerAccess#attachDevice}) alike. A device's id is the same
 * wherever it is attached ({@link dan200.computercraft.core.computer.ComputerEnvironment#deviceId}); a side name still
 * finds the device on that side. The ROM module {@code peripheral} wraps this one.
 *
 * @cc.module internal/peripheral
 * @hidden
 */
public class PeripheralAPI implements IComputerAPI, IAPIEnvironment.IPeripheralChangeListener {
    private final class PeripheralWrapper extends ComputerAccess implements GuardedContext.Guard {
        private final String id;
        private final IPeripheral peripheral;
        /** The device that attached this one ({@link #attachDevice}), or {@code null} for a device on a side. */
        private final @Nullable PeripheralWrapper owner;

        private final String type;
        private final Set<String> additionalTypes;
        private final Map<String, PeripheralMethod> methodMap;
        private boolean attached = false;

        private @Nullable GuardedContext contextWrapper;

        PeripheralWrapper(IPeripheral peripheral, String id, @Nullable PeripheralWrapper owner) {
            super(environment);
            this.id = id;
            this.peripheral = peripheral;
            this.owner = owner;

            type = Objects.requireNonNull(peripheral.getType(), "Peripheral type cannot be null");
            additionalTypes = peripheral.getAdditionalTypes();

            methodMap = peripheralMethods.getSelfMethods(peripheral);
        }

        private List<String> getTypes() {
            var types = new ArrayList<String>(1 + additionalTypes.size());
            types.add(type);
            types.addAll(additionalTypes);
            return types;
        }

        private boolean hasType(String type) {
            return this.type.equals(type) || additionalTypes.contains(type);
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
            return id;
        }

        @Override
        public void attachDevice(String id, IPeripheral peripheral) {
            if (!attached) throw new NotAttachedException();
            addDevice(new PeripheralWrapper(peripheral, id, this));
        }

        @Override
        public void detachDevice(String id) {
            if (!attached) throw new NotAttachedException();
            synchronized (devices) {
                var attachments = devices.get(id);
                if (attachments == null) return;
                for (var device : List.copyOf(attachments)) {
                    if (device.owner == this) removeDevice(device);
                }
            }
        }

        @Override
        public Map<String, IPeripheral> getAvailablePeripherals() {
            if (!attached) throw new NotAttachedException();

            Map<String, IPeripheral> peripherals = new HashMap<>();
            synchronized (devices) {
                for (var entry : devices.entrySet()) peripherals.put(entry.getKey(), entry.getValue().getFirst().peripheral);
            }
            return Collections.unmodifiableMap(peripherals);
        }

        @Nullable
        @Override
        public IPeripheral getAvailablePeripheral(String name) {
            if (!attached) throw new NotAttachedException();
            var device = find(name);
            return device == null ? null : device.peripheral;
        }

        @Override
        public WorkMonitor getMainThreadMonitor() {
            if (!attached) throw new NotAttachedException();
            return super.getMainThreadMonitor();
        }
    }

    private final IAPIEnvironment environment;
    private final MethodSupplier<PeripheralMethod> peripheralMethods;
    /** The device on each side. */
    private final @Nullable PeripheralWrapper[] sides = new PeripheralWrapper[6];
    /**
     * Every device by id. A device reached in several ways (on a side and through a cable) is attached once: the
     * first of its attachments is the one in use, the next takes over when it goes.
     */
    private final Map<String, List<PeripheralWrapper>> devices = new HashMap<>();
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
        synchronized (devices) {
            var index = side.ordinal();
            var old = sides[index];
            if (old != null) {
                sides[index] = null;
                removeDevice(old);
            }

            if (newPeripheral != null) {
                var id = environment.getComputerEnvironment().deviceId(side, newPeripheral);
                var device = sides[index] = new PeripheralWrapper(newPeripheral, id, null);
                addDevice(device);
            }
        }
    }

    private void addDevice(PeripheralWrapper device) {
        synchronized (devices) {
            var attachments = devices.computeIfAbsent(device.id, k -> new ArrayList<>(1));
            attachments.add(device);
            if (attachments.size() > 1) return;

            if (running) device.attach();
            environment.queueEvent(new CoreEvents.PeripheralAttach(device.id));
        }
    }

    private void removeDevice(PeripheralWrapper device) {
        synchronized (devices) {
            var attachments = devices.get(device.id);
            if (attachments == null) return;
            var inUse = !attachments.isEmpty() && attachments.getFirst() == device;
            if (!attachments.remove(device)) return;

            // Detaching a hub detaches the devices it attached; whatever it forgets goes with it too.
            if (device.isAttached()) device.detach();
            for (var attachmentsOfId : List.copyOf(devices.values())) {
                for (var other : List.copyOf(attachmentsOfId)) {
                    if (other.owner == device) removeDevice(other);
                }
            }

            if (attachments.isEmpty()) {
                devices.remove(device.id);
                environment.queueEvent(new CoreEvents.PeripheralDetach(device.id));
            } else if (inUse && running) {
                attachments.getFirst().attach();
            }
        }
    }

    /** The device in use with this id, or on this side. */
    private @Nullable PeripheralWrapper find(String name) {
        synchronized (devices) {
            var attachments = devices.get(name);
            if (attachments != null) return attachments.getFirst();

            var side = ComputerSide.valueOfInsensitive(name);
            var device = side == null ? null : sides[side.ordinal()];
            if (device == null) return null;
            attachments = devices.get(device.id);
            return attachments == null ? null : attachments.getFirst();
        }
    }

    @Override
    public String[] getNames() {
        return new String[]{ "internal/peripheral" };
    }

    @Override
    public void startup() {
        synchronized (devices) {
            running = true;
            for (var attachments : List.copyOf(devices.values())) {
                var device = attachments.getFirst();
                if (!device.isAttached()) device.attach();
            }
        }
    }

    @Override
    public void shutdown() {
        synchronized (devices) {
            running = false;
            for (var attachments : List.copyOf(devices.values())) {
                if (attachments.isEmpty()) continue;
                var device = attachments.getFirst();
                if (device.isAttached()) device.detach();
            }
        }
    }

    /**
     * The ids of every attached device, on a side or reached through a network, sorted.
     *
     * @return The device ids.
     */
    @ScriptFunction("getNames")
    public final List<String> getDeviceNames() {
        synchronized (devices) {
            var names = new ArrayList<>(devices.keySet());
            names.sort(Comparator.naturalOrder());
            return names;
        }
    }

    /**
     * The id of the device on a side.
     *
     * @param sideName The side.
     * @return The device's id, or {@code null} if nothing is attached there.
     */
    @ScriptFunction
    public final @Nullable String getDeviceOn(String sideName) {
        var side = ComputerSide.valueOfInsensitive(sideName);
        if (side == null) return null;
        synchronized (devices) {
            var device = sides[side.ordinal()];
            return device == null ? null : device.id;
        }
    }

    /**
     * Whether a device is attached.
     *
     * @param name The device's id (or a side).
     * @return Whether the device is attached.
     */
    @ScriptFunction
    public final boolean isPresent(String name) {
        return find(name) != null;
    }

    /**
     * The types of a device: its primary type first, then any additional types.
     *
     * @param name The device's id (or a side).
     * @return The device's types, or {@code null} if it is not attached.
     */
    @ScriptFunction
    public final @Nullable List<String> getType(String name) {
        // A single List (one JS array) rather than an Object[], which the bridge would treat as multiple return values.
        var device = find(name);
        return device == null ? null : device.getTypes();
    }

    /**
     * Whether a device has a type (primary or additional).
     *
     * @param name The device's id (or a side).
     * @param type The type to look for.
     * @return Whether the device has that type, or {@code null} if it is not attached.
     */
    @ScriptFunction
    public final @Nullable Boolean hasType(String name, String type) {
        var device = find(name);
        return device == null ? null : device.hasType(type);
    }

    /**
     * The names of the methods a device provides.
     *
     * @param name The device's id (or a side).
     * @return The method names, or {@code null} if it is not attached.
     */
    @ScriptFunction
    public final @Nullable Collection<String> getMethods(String name) {
        var device = find(name);
        return device == null ? null : device.getMethods();
    }

    /**
     * Call a method of a device.
     *
     * @param context The calling context.
     * @param args    The device's id (or a side), the method name, and the method's arguments.
     * @return Whatever the method returns.
     * @throws ScriptException If the device is not attached, there is no such method, or the method fails.
     * @cc-r.params {@code name: string, method: string, ...args: unknown[]}
     * @cc-r.return unknown
     */
    @ScriptFunction
    public final MethodResult call(IContext context, IArguments args) throws ScriptException {
        var name = args.getString(0);
        var methodName = args.getString(1);
        var methodArgs = args.drop(2);

        var device = find(name);
        if (device == null) throw new ScriptException("No such device: " + name);

        try {
            return device.call(context, methodName, methodArgs).adjustError(1);
        } catch (ScriptException e) {
            // We increase the error level by one in order to shift the error level to where peripheral.call was
            // invoked. It would be possible to do it in script code, but would add significantly more overhead.
            if (e.getLevel() > 0) throw new FastScriptException(e.getMessage(), e.getLevel() + 1);
            throw e;
        }
    }
}
