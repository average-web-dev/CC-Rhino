// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `peripheral` — the computer's devices (ROM module /rom/lib/peripheral) around the native `internal/peripheral`
// (#61). A device has an id (`monitor_3`) that is the same on every computer and wherever it is attached: on a side or
// through a wired network, both alike. Functions that take a device accept its id or its /dev path.

/** A device, as peripheral.list() / get() report it (a snapshot). */
interface DeviceInfo {
    /** Its id: `<type>_<n>`, the same on every computer. */
    readonly id: string;
    /** Its types: the primary type first, then any additional types. */
    readonly types: readonly string[];
    /** Its device file (`/dev/monitor0`), once the OS named it (/rom/lib/internal/devices). */
    readonly path?: string;
}

/** The device types the mod knows, for typed wrap() / find(). */
interface PeripheralTypeMap {
    command: CommandBlockPeripheral;
    computer: ComputerPeripheral;
    drive: DiskDrivePeripheral;
    modem: ModemPeripheral;
    monitor: MonitorPeripheral;
    printer: PrinterPeripheral;
    redstone_relay: RedstoneRelayPeripheral;
    speaker: SpeakerPeripheral;
    workbench: CraftingTablePeripheral;
}

/** A wrapped device: its methods, plus its id and types. */
type Device<T extends IPeripheral = IPeripheral> = T & {
    /** The device's id. */
    readonly id: string;
    /** The device's types. */
    readonly types: readonly string[];
};

/**
 * The device type an id (`monitor_3`) or /dev path (`/dev/monitor0`) names, or `IPeripheral` for anything else.
 */
type DeviceTypeOf<P extends string> = DeviceTypeOrNever<P> extends infer T extends IPeripheral
    ? ([T] extends [never] ? IPeripheral : T) : IPeripheral;
type DeviceTypeOrNever<P extends string> = {
    [K in keyof PeripheralTypeMap]: P extends `/dev/${K}${number}` | `${K}_${number}` ? PeripheralTypeMap[K] : never
}[keyof PeripheralTypeMap];

/** The events of the `peripheral` module: a device was attached or detached (its /dev path is set). */
interface PeripheralEventMap {
    attach: [device: DeviceInfo];
    detach: [device: DeviceInfo];
}

interface CustomEventMap {
    /** A device was attached and named (emitted by the OS's device registry; peripheral.on('attach') listens to it). */
    device_attach: [device: DeviceInfo];
    /** A device was detached; its /dev file is gone. */
    device_detach: [device: DeviceInfo];
}

/** The native functions for the OS (filling /dev), which `peripheral` does not pass on. */
type PeripheralOsFunctions = 'setDeviceFile' | 'removeDeviceFile';

interface PeripheralModule extends Omit<PeripheralAPI, PeripheralOsFunctions> {
    /** Every attached device, sorted by id. */
    list(): DeviceInfo[];
    /** A device by id or /dev path, or undefined if it is not attached. */
    get(idOrPath: string): DeviceInfo | undefined;
    /**
     * A device's methods as an object (`wrap('monitor_0').setTextScale(2)`), or undefined if it is not attached.
     * Typed by the id or path: `wrap('/dev/monitor0')` is a `MonitorPeripheral`.
     */
    wrap<P extends string>(idOrPath: P): Device<DeviceTypeOf<P>> | undefined;
    /** Every device of a type (primary or additional), wrapped; `filter` picks some of them. */
    find<K extends keyof PeripheralTypeMap>(type: K, filter?: (device: Device<PeripheralTypeMap[K]>) => boolean): Device<PeripheralTypeMap[K]>[];
    find(type: string, filter?: (device: Device) => boolean): Device[];
    /**
     * Listen to devices being attached ('attach') and detached ('detach'), on a side or through a cable. Like
     * `events.on` (they are the events `device_attach` / `device_detach`): the listener belongs to the calling thread.
     */
    on<K extends keyof PeripheralEventMap>(event: K, listener: (...args: PeripheralEventMap[K]) => void): PeripheralModule;
    once<K extends keyof PeripheralEventMap>(event: K, listener: (...args: PeripheralEventMap[K]) => void): PeripheralModule;
    off<K extends keyof PeripheralEventMap>(event: K, listener: (...args: PeripheralEventMap[K]) => void): PeripheralModule;
}

interface PeripheralModulePromises extends Omit<PeripheralAPIPromises, PeripheralOsFunctions> {
    list(): Promise<DeviceInfo[]>;
    get(idOrPath: string): Promise<DeviceInfo | undefined>;
}

declare function require(id: "peripheral"): PeripheralModule;
declare function require(id: "peripheral/promises"): PeripheralModulePromises;
declare module "peripheral" { const peripheral: PeripheralModule; export = peripheral; }
declare module "peripheral/promises" { const peripheralPromises: PeripheralModulePromises; export = peripheralPromises; }
declare module "internal/peripheral" { const peripheral: PeripheralAPI; export = peripheral; }
declare module "internal/peripheral/promises" { const peripheralPromises: PeripheralAPIPromises; export = peripheralPromises; }
