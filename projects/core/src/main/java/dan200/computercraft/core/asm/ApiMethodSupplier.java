// SPDX-FileCopyrightText: 2023 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.asm;

import dan200.computercraft.api.scripting.IDynamicObject;
import dan200.computercraft.api.scripting.IContext;
import dan200.computercraft.api.scripting.MethodResult;
import dan200.computercraft.core.ComputerContext;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;

import java.util.List;
import java.util.Objects;

/**
 * Provides a {@link MethodSupplier} for {@link ApiMethod}s.
 * <p>
 * This is used by {@link ComputerContext} to construct {@linkplain ComputerContext#peripheralMethods() the context-wide
 * method supplier}. It should not be used directly.
 */
public final class ApiMethodSupplier {
    private static final Generator<ApiMethod> GENERATOR = new Generator<>(List.of(IContext.class),
        m -> (target, context, args) -> {
            try {
                return (MethodResult) m.invokeExact(target, context, args);
            } catch (Throwable t) {
                throw ResultHelpers.throwUnchecked(t);
            }
        },
        m -> (target, context, args) -> {
            args.escapes();
            return context.executeMainThreadTask(() -> ResultHelpers.checkNormalResult(m.apply(target, context, args)));
        }
    );
    private static final IntCache<ApiMethod> DYNAMIC = new IntCache<>(
        method -> (instance, context, args) -> ((IDynamicObject) instance).callMethod(context, method, args)
    );

    private ApiMethodSupplier() {
    }

    public static MethodSupplier<ApiMethod> create(List<GenericMethod> genericMethods) {
        return new MethodSupplierImpl<>(genericMethods, GENERATOR, DYNAMIC, x -> x instanceof IDynamicObject dynamic
            ? Objects.requireNonNull(dynamic.getMethodNames(), "Dynamic methods cannot be null")
            : null
        );
    }
}
