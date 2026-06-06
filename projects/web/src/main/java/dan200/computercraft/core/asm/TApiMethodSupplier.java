// SPDX-FileCopyrightText: 2023 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.asm;

import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.MethodSupplier;
import dan200.computercraft.core.methods.ObjectSource;

import java.util.List;

/**
 * Replaces {@link ApiMethodSupplier} with a version which uses {@link MethodReflection} to fabricate the classes.
 */
public final class TApiMethodSupplier implements MethodSupplier<ApiMethod> {
    static final TApiMethodSupplier INSTANCE = new TApiMethodSupplier();

    private TApiMethodSupplier() {
    }

    @Override
    public boolean forEachSelfMethod(Object object, UntargetedConsumer<ApiMethod> consumer) {
        return MethodReflection.getMethods(object.getClass(), method -> consumer.accept(method.name(), method.method(), method));
    }

    @Override
    public boolean forEachMethod(Object object, TargetedConsumer<ApiMethod> consumer) {
        var hasMethods = MethodReflection.getMethods(object.getClass(), method -> consumer.accept(object, method.name(), method.method(), method));

        if (object instanceof ObjectSource source) {
            for (var extra : source.getExtra()) {
                hasMethods |= MethodReflection.getMethods(extra.getClass(), method -> consumer.accept(extra, method.name(), method.method(), method));
            }
        }

        return hasMethods;
    }

    public static MethodSupplier<ApiMethod> create(List<GenericMethod> genericMethods) {
        return INSTANCE;
    }
}
