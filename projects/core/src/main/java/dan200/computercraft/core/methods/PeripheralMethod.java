// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.methods;

import dan200.computercraft.api.scripting.*;
import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.api.peripheral.IDynamicPeripheral;
import dan200.computercraft.api.peripheral.IPeripheral;

/**
 * A Lua function associated with some peripheral.
 * <p>
 * This interface is not typically implemented yourself, but instead generated from a {@link ScriptFunction}-annotated
 * method.
 *
 * @see NamedMethod
 * @see IPeripheral
 */
@FunctionalInterface
public interface PeripheralMethod {
    /**
     * Apply this method.
     *
     * @param target   The object instance that this method targets.
     * @param context  The Lua context for this function call.
     * @param computer The interface to the computer that is making the call.
     * @param args     Arguments to this function.
     * @return The return call of this function.
     * @throws ScriptException Thrown by the underlying method call.
     * @see IDynamicPeripheral#callMethod(IComputerAccess, IContext, int, IArguments)
     */
    MethodResult apply(Object target, IContext context, IComputerAccess computer, IArguments args) throws ScriptException;
}
