// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.asm;

import dan200.computercraft.api.scripting.*;
import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.core.computer.ComputerSide;
import dan200.computercraft.core.methods.ApiMethod;
import dan200.computercraft.core.methods.NamedMethod;
import org.hamcrest.Matcher;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.lang.invoke.MethodHandles;
import java.util.Collection;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Stream;

import static dan200.computercraft.test.core.ContramapMatcher.contramap;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.assertThrows;

public class GeneratorTest {
    private static final MethodSupplierImpl<ApiMethod> GENERATOR = (MethodSupplierImpl<ApiMethod>) ApiMethodSupplier.create(
        Stream.of(new StaticGeneric(), new InstanceGeneric()).flatMap(GenericMethod::getMethods).toList()
    );

    @Test
    public void testBasic() {
        var methods = GENERATOR.getMethods(Basic.class);
        assertThat(methods, contains(
            allOf(
                named("go"),
                contramap(is(true), "non-yielding", NamedMethod::nonYielding)
            )
        ));
    }

    @Test
    public void testIdentical() {
        var methods = GENERATOR.getMethods(Basic.class);
        var methods2 = GENERATOR.getMethods(Basic.class);
        assertThat(methods, sameInstance(methods2));
    }

    @Test
    public void testIdenticalMethods() {
        var methods = GENERATOR.getMethods(Basic.class);
        var methods2 = GENERATOR.getMethods(Basic2.class);
        assertThat(methods, contains(named("go")));
        assertThat(methods.get(0).method(), sameInstance(methods2.get(0).method()));
    }

    @Test
    public void testEmptyClass() {
        assertThat(GENERATOR.getMethods(Empty.class), is(empty()));
    }

    @Test
    public void testNonPublicClass() throws ScriptException {
        var methods = GENERATOR.getMethods(NonPublic.class);
        assertThat(methods, contains(named("go")));
        assertThat(apply(methods, new NonPublic(), "go"), is(MethodResult.of()));
    }

    @Test
    public void testNonInstance() {
        assertThat(GENERATOR.getMethods(NonInstance.class), is(empty()));
    }

    @Test
    public void testStaticGenericMethod() throws ScriptException {
        var methods = GENERATOR.getMethods(GenericMethodTarget.class);
        assertThat(methods, hasItem(named("goStatic")));
        assertThat(apply(methods, new GenericMethodTarget(), "goStatic", "Hello", 123), is(MethodResult.of()));
    }


    @Test
    public void testInstanceGenericrMethod() throws ScriptException {
        var methods = GENERATOR.getMethods(GenericMethodTarget.class);
        assertThat(methods, hasItem(named("goInstance")));
        assertThat(apply(methods, new GenericMethodTarget(), "goInstance", "Hello", 123), is(MethodResult.of()));
    }

    @Test
    public void testIllegalThrows() {
        assertThat(GENERATOR.getMethods(IllegalThrows.class), is(empty()));
    }

    @Test
    public void testCustomNames() {
        var methods = GENERATOR.getMethods(CustomNames.class);
        assertThat(methods, contains(named("go1"), named("go2")));
    }

    @Test
    public void testArgKinds() {
        var methods = GENERATOR.getMethods(ArgKinds.class);
        assertThat(methods, containsInAnyOrder(
            named("objectArg"), named("intArg"), named("optIntArg"),
            named("context"), named("arguments")
        ));
    }

    @Test
    public void testEnum() throws ScriptException {
        var methods = GENERATOR.getMethods(EnumMethods.class);
        assertThat(methods, containsInAnyOrder(named("getEnum"), named("optEnum")));

        assertThat(apply(methods, new EnumMethods(), "getEnum", "front"), one(is("FRONT")));
        assertThat(apply(methods, new EnumMethods(), "optEnum", "front"), one(is("FRONT")));
        assertThat(apply(methods, new EnumMethods(), "optEnum"), one(is("?")));
        assertThrows(ScriptException.class, () -> apply(methods, new EnumMethods(), "getEnum", "not as side"));
    }

    @Test
    public void testLuaTable() throws ScriptException {
        var methods = GENERATOR.getMethods(TableMethods.class);
        assertThat(methods, containsInAnyOrder(named("getTable"), named("optTable")));

        assertThat(apply(methods, new TableMethods(), "getTable", Map.of("x", "y")), one(is(Map.of("x", "y"))));
        assertThat(apply(methods, new TableMethods(), "optTable", Map.of("x", "y")), one(is(Map.of("x", "y"))));
        assertThat(apply(methods, new TableMethods(), "optTable"), one(nullValue()));
        assertThrows(ScriptException.class, () -> apply(methods, new TableMethods(), "getTable", "not a table"));
    }

    @Test
    public void testMainThread() throws ScriptException {
        var methods = GENERATOR.getMethods(MainThread.class);
        assertThat(methods, contains(allOf(
            named("go"),
            contramap(is(false), "non-yielding", NamedMethod::nonYielding)
        )));

        assertThat(apply(methods, new MainThread(), "go"),
            contramap(notNullValue(), "callback", MethodResult::getCallback));
    }

    @Test
    public void testUnsafe() {
        var methods = GENERATOR.getMethods(Unsafe.class);
        assertThat(methods, contains(named("withUnsafe")));
    }

    @Test
    public void testClassNotAccessible() throws IOException, ReflectiveOperationException, ScriptException {
        var basicName = Basic.class.getName().replace('.', '/');

        // Load our Basic class, rewriting it to be a separate (hidden) class which is not part of the same nest as
        // the existing Basic.
        ClassReader reader;
        try (var input = getClass().getClassLoader().getResourceAsStream(basicName + ".class")) {
            reader = new ClassReader(Objects.requireNonNull(input, "Cannot find " + basicName));
        }
        var writer = new ClassWriter(reader, 0);
        reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
            @Override
            public void visitNestHost(String nestHost) {
            }

            @Override
            public void visitInnerClass(String name, String outerName, String innerName, int access) {
            }
        }, 0);

        var klass = MethodHandles.lookup().defineHiddenClass(writer.toByteArray(), true).lookupClass();

        var methods = GENERATOR.getMethods(klass);
        assertThat(apply(methods, klass.getConstructor().newInstance(), "go"), equalTo(MethodResult.of()));
    }

    public static class Basic {
        @ScriptFunction
        public final void go() {
        }
    }

    public static class Basic2 extends Basic {
    }

    public static class Empty {
    }

    static class NonPublic {
        @ScriptFunction
        public final void go() {
        }
    }

    public static class NonInstance {
        @ScriptFunction
        public static void go() {
        }
    }

    public static class GenericMethodTarget {
    }

    public static class StaticGeneric implements GenericSource {
        @Override
        public String id() {
            return "static";
        }

        @ScriptFunction
        public static void goStatic(GenericMethodTarget target, String arg1, int arg2, IContext context) {
        }
    }

    public static class InstanceGeneric implements GenericSource {
        @Override
        public String id() {
            return "instance";
        }

        @ScriptFunction
        public void goInstance(GenericMethodTarget target, String arg1, int arg2, IContext context) {
        }
    }

    public static class IllegalThrows {
        @ScriptFunction
        @SuppressWarnings("DoNotCallSuggester")
        public final void go() throws IOException {
            throw new IOException();
        }
    }

    public static class CustomNames {
        @ScriptFunction({ "go1", "go2" })
        public final void go() {
        }
    }

    public static class ArgKinds {
        @ScriptFunction
        public final void objectArg(Object arg) {
        }

        @ScriptFunction
        public final void intArg(int arg) {
        }

        @ScriptFunction
        public final void optIntArg(Optional<Integer> arg) {
        }

        @ScriptFunction
        public final void context(IContext arg) {
        }

        @ScriptFunction
        public final void arguments(IArguments arg) {
        }

        @ScriptFunction
        public final void unknown(IComputerAccess arg) {
        }

        @ScriptFunction
        public final void illegalMap(Map<String, Integer> arg) {
        }

        @ScriptFunction
        public final void optIllegalMap(Optional<Map<String, Integer>> arg) {
        }
    }

    public static class EnumMethods {
        @ScriptFunction
        public final String getEnum(ComputerSide side) {
            return side.name();
        }

        @ScriptFunction
        public final String optEnum(Optional<ComputerSide> side) {
            return side.map(ComputerSide::name).orElse("?");
        }
    }

    public static class TableMethods {
        @ScriptFunction
        public final ScriptTable<?, ?> getTable(ScriptTable<?, ?> table) {
            return table;
        }

        @ScriptFunction
        public final @Nullable ScriptTable<?, ?> optTable(Optional<ScriptTable<?, ?>> table) {
            return table.orElse(null);
        }
    }

    public static class MainThread {
        @ScriptFunction(mainThread = true)
        public final void go() {
        }
    }

    public static class Unsafe {
        @ScriptFunction(unsafe = true)
        public final void withUnsafe(ScriptTable<?, ?> table) {
        }

        @ScriptFunction(unsafe = true, mainThread = true)
        public final void invalid(ScriptTable<?, ?> table) {
        }
    }

    private static <T> T find(Collection<NamedMethod<T>> methods, String name) {
        return methods.stream()
            .filter(x -> x.name().equals(name))
            .map(NamedMethod::method)
            .findAny()
            .orElseThrow(NullPointerException::new);
    }

    public static MethodResult apply(Collection<NamedMethod<ApiMethod>> methods, Object instance, String name, Object... args) throws ScriptException {
        return find(methods, name).apply(instance, CONTEXT, new ObjectArguments(args));
    }

    public static Matcher<MethodResult> one(Matcher<Object> object) {
        return allOf(
            contramap(nullValue(), "callback", MethodResult::getCallback),
            contramap(array(object), "result", MethodResult::getResult)
        );
    }

    public static <T> Matcher<NamedMethod<T>> named(String method) {
        return contramap(is(method), "name", NamedMethod::name);
    }

    private static final IContext CONTEXT = new IContext() {
        @Override
        public long issueMainThreadTask(ScriptTask task) {
            return 0;
        }
    };
}
