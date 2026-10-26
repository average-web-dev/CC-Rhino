<!--
SPDX-FileCopyrightText: 2017 The CC: Tweaked Developers

SPDX-License-Identifier: MPL-2.0
-->

# CC: Rhino

CC: Rhino is a fork of [CC: Tweaked][cc-tweaked] that replaces the Lua/Cobalt runtime with a Mozilla
Rhino-based JavaScript engine, letting you program in-game computers and turtles in JavaScript instead of Lua.
Like its parent, it builds on the much-beloved [ComputerCraft] and runs on both [Minecraft Forge] and [Fabric].

CC: Rhino is an independent fork and is not affiliated with or endorsed by the CC: Tweaked or ComputerCraft teams.

## Contributing
CC: Rhino is still at a very early stage and changing quickly, so **outside contributions are not being accepted yet**.
Please don't open pull requests for now. Bug reports and feedback are welcome as [issues][issues]. Once things are more
stable, contributions will be very welcome and suitable issues will be opened for them.

If you want to build the mod yourself, [check out the instructions here](CONTRIBUTING.md#setting-up-a-development-environment).

## Community
CC: Rhino has no community channels of its own yet. For questions or feedback about the fork, please use the
[issue tracker][issues].

For ComputerCraft in general, the CC: Tweaked [GitHub discussions page][GitHub discussions] and the `#computercraft`
IRC channel on [EsperNet] ([KiwiIRC]) are good places to ask. Note that the documentation at
[tweaked.cc](https://tweaked.cc/ "The CC: Tweaked website") describes CC: Tweaked's **Lua** API; the JavaScript API of
CC: Rhino is described in [JS_API_REDESIGN.md](JS_API_REDESIGN.md).

## Using
CC: Rhino is not published to a Maven repository yet. To depend on it, build it from source and publish it to your
local Maven repository:

```sh
./gradlew publishToMavenLocal
```

```groovy
repositories {
  mavenLocal()
}

dependencies {
  // Vanilla (i.e. for multi-loader systems)
  compileOnly("cc.tweaked:cc-rhino-$mcVersion-common-api:$rhinoVersion")

  // Forge Gradle
  compileOnly("cc.tweaked:cc-rhino-$mcVersion-forge-api:$rhinoVersion")
  runtimeOnly("cc.tweaked:cc-rhino-$mcVersion-forge:$rhinoVersion")

  // Fabric Loom
  modCompileOnly("cc.tweaked:cc-rhino-$mcVersion-fabric-api:$rhinoVersion")
  modRuntimeOnly("cc.tweaked:cc-rhino-$mcVersion-fabric:$rhinoVersion")
}
```

Only use classes within the `dan200.computercraft.api` package. Non-API classes are subject to change at any point.

The API is **not** compatible with CC: Tweaked addons: Lua-specific types (`@LuaFunction`, `ILuaContext`, …) are
replaced by the scripting API in `dan200.computercraft.api.scripting` (`@ScriptFunction`, `MethodResult`, `Result`).
Mods written against CC: Tweaked will not work unchanged; a compatibility layer is tracked in [#33][compat].

We bundle the API sources with the jar, so documentation should be easily viewable within your editor.

[issues]: https://github.com/average-web-dev/CC-Rhino/issues "CC: Rhino issues"
[compat]: https://github.com/average-web-dev/CC-Rhino/issues/33 "Compatibility layer for CC: Tweaked addons"
[cc-tweaked]: https://github.com/cc-tweaked/CC-Tweaked "CC: Tweaked on GitHub"
[computercraft]: https://github.com/dan200/ComputerCraft "ComputerCraft on GitHub"
[Minecraft Forge]: https://files.minecraftforge.net/ "Download Minecraft Forge."
[Fabric]: https://fabricmc.net/use/installer/ "Download Fabric."
[GitHub Discussions]: https://github.com/cc-tweaked/CC-Tweaked/discussions
[EsperNet]: https://www.esper.net/
[KiwiIRC]: https://kiwiirc.com/nextclient/#irc://irc.esper.net:+6697/#computercraft "#computercraft on EsperNet"
