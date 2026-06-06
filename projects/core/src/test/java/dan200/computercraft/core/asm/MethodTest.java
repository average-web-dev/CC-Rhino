// SPDX-FileCopyrightText: 2020 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.core.asm;

import dan200.computercraft.api.scripting.*;
import dan200.computercraft.api.peripheral.IComputerAccess;
import dan200.computercraft.api.peripheral.IDynamicPeripheral;
import dan200.computercraft.api.peripheral.IPeripheral;
import dan200.computercraft.core.computer.ComputerBootstrap;
import dan200.computercraft.core.computer.ComputerSide;
import dan200.computercraft.core.methods.ObjectSource;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

public class MethodTest {
    @Test
    public void testMainThread() {
        ComputerBootstrap.run("assert(main_thread.go() == 123)", x -> x.addApi(new MainThread()), 50);
    }

    @Test
    public void testMainThreadPeripheral() {
        ComputerBootstrap.run("assert(peripheral.call('top', 'go') == 123)",
            x -> x.getEnvironment().setPeripheral(ComputerSide.TOP, new MainThread()),
            50);
    }

    @Test
    public void testMainThreadReturnObject() {
        ComputerBootstrap.run("assert(type(main_thread.complex().go) == \"function\")", x -> x.addApi(new MainThread()), 50);
    }

    @Test
    public void testDynamic() {
        ComputerBootstrap.run(
            "assert(dynamic.foo() == 123, 'foo: ' .. tostring(dynamic.foo()))\n" +
                "assert(dynamic.bar() == 321, 'bar: ' .. tostring(dynamic.bar()))",
            x -> x.addApi(new Dynamic()), 50);
    }

    @Test
    public void testDynamicPeripheral() {
        ComputerBootstrap.run(
            """
                local dynamic = peripheral.wrap('top')
                assert(dynamic.foo() == 123, 'foo: ' .. tostring(dynamic.foo()))
                assert(dynamic.bar() == 321, 'bar: ' .. tostring(dynamic.bar()))""",
            x -> x.getEnvironment().setPeripheral(ComputerSide.TOP, new Dynamic()),
            50
        );
    }

    @Test
    public void testExtra() {
        ComputerBootstrap.run("assert(extra.go() == nil, 'go')\nassert(extra.go2() == 456, 'go2')",
            x -> x.addApi(new ExtraObject()),
            50);
    }

    @Test
    public void testPeripheralThrow() {
        ComputerBootstrap.run(
            """
                local throw = peripheral.wrap('top')
                local _, err = pcall(function() throw.thisThread() end) assert(err == '/test.lua:2: !', ("thisThread: %q"):format(err))
                local _, err = pcall(function() throw.mainThread() end) assert(err == '/test.lua:3: !', ("mainThread: %q"):format(err))""",
            x -> x.getEnvironment().setPeripheral(ComputerSide.TOP, new PeripheralThrow()),
            50
        );
    }

    @Test
    public void testMany() {
        ComputerBootstrap.run(
            """
                assert(many.method_0)
                assert(many.method_39)""",
            x -> x.addApi(new ManyMethods()), 50);
    }

    @Test
    public void testFunction() {
        ComputerBootstrap.run(
            "assert(func.call()(123) == 123)",
            x -> x.addApi(new ReturnFunction()), 50);
    }


    @Test
    public void testModule() {
        ComputerBootstrap.run(
            """
                assert(require "test.module".func() == 123)""",
            x -> x.addApi(new IsModule()), 50);
    }

    public static class MainThread implements IComputerAPI, IPeripheral {
        public final String thread = Thread.currentThread().getName();

        @Override
        public String[] getNames() {
            return new String[]{ "main_thread" };
        }

        @ScriptFunction(mainThread = true)
        public final int go() {
            assertThat(Thread.currentThread().getName(), is(thread));
            return 123;
        }

        @ScriptFunction(mainThread = true)
        public final Object complex() {
            return this;
        }

        @Override
        public String getType() {
            return "main_thread";
        }

        @Override
        public boolean equals(@Nullable IPeripheral other) {
            return this == other;
        }
    }

    public static class Dynamic implements IDynamicObject, IComputerAPI, IDynamicPeripheral {
        @Override
        public String[] getMethodNames() {
            return new String[]{ "foo" };
        }

        @Override
        public MethodResult callMethod(IContext context, int method, IArguments arguments) {
            return MethodResult.of(123);
        }

        @Override
        public MethodResult callMethod(IComputerAccess computer, IContext context, int method, IArguments arguments) {
            return callMethod(context, method, arguments);
        }

        @ScriptFunction
        public final int bar() {
            return 321;
        }

        @Override
        public String[] getNames() {
            return new String[]{ "dynamic" };
        }

        @Override
        public String getType() {
            return "dynamic";
        }

        @Override
        public boolean equals(@Nullable IPeripheral other) {
            return this == other;
        }
    }

    public static class ExtraObject implements ObjectSource, IComputerAPI {
        @Override
        public String[] getNames() {
            return new String[]{ "extra" };
        }

        @ScriptFunction
        public final int go2() {
            return 456;
        }

        @Override
        public Iterable<Object> getExtra() {
            return List.of(new GeneratorTest.Basic());
        }
    }

    public static class PeripheralThrow implements IPeripheral {
        @ScriptFunction
        @SuppressWarnings("DoNotCallSuggester")
        public final void thisThread() throws ScriptException {
            throw new ScriptException("!");
        }

        @ScriptFunction(mainThread = true)
        @SuppressWarnings("DoNotCallSuggester")
        public final void mainThread() throws ScriptException {
            throw new ScriptException("!");
        }

        @Override
        public String getType() {
            return "throw";
        }

        @Override
        public boolean equals(@Nullable IPeripheral other) {
            return this == other;
        }
    }

    public static class ManyMethods implements IDynamicObject, IComputerAPI {
        @Override
        public String[] getMethodNames() {
            var methods = new String[40];
            for (var i = 0; i < methods.length; i++) methods[i] = "method_" + i;
            return methods;
        }

        @Override
        public MethodResult callMethod(IContext context, int method, IArguments arguments) {
            return MethodResult.of();
        }

        @Override
        public String[] getNames() {
            return new String[]{ "many" };
        }
    }

    public static class ReturnFunction implements IComputerAPI {
        @ScriptFunction
        public final IFunction call() {
            return args -> MethodResult.of(args.getAll());
        }

        @Override
        public String[] getNames() {
            return new String[]{ "func" };
        }
    }

    public static class IsModule implements IComputerAPI {
        @Override
        public String[] getNames() {
            return new String[0];
        }

        @Override
        public @Nullable String getModuleName() {
            return "test.module";
        }

        @ScriptFunction
        public final int func() {
            return 123;
        }
    }
}
