// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package dan200.computercraft.gametest

import dan200.computercraft.api.ComputerCraftAPI
import dan200.computercraft.api.ComputerCraftTags
import dan200.computercraft.api.detail.ComponentDetailProvider
import dan200.computercraft.api.detail.VanillaDetailRegistries
import dan200.computercraft.api.scripting.Result as ScriptResult
import dan200.computercraft.api.turtle.ITurtleUpgrade
import dan200.computercraft.api.turtle.TurtleSide
import dan200.computercraft.api.upgrades.UpgradeData
import dan200.computercraft.core.apis.PeripheralAPI
import dan200.computercraft.core.computer.ComputerSide
import dan200.computercraft.gametest.api.*
import dan200.computercraft.gametest.core.TestHooks
import dan200.computercraft.impl.TurtleUpgrades
import dan200.computercraft.mixin.gametest.GameTestHelperAccessor
import dan200.computercraft.mixin.gametest.GameTestInfoAccessor
import dan200.computercraft.shared.ModRegistry
import dan200.computercraft.shared.config.Config
import dan200.computercraft.shared.media.items.PrintoutData
import dan200.computercraft.shared.peripheral.modem.wired.CableBlock
import dan200.computercraft.shared.peripheral.modem.wired.CableModemVariant
import dan200.computercraft.shared.peripheral.monitor.MonitorBlock
import dan200.computercraft.shared.peripheral.monitor.MonitorEdgeState
import dan200.computercraft.shared.turtle.TurtleOverlay
import dan200.computercraft.shared.turtle.apis.TurtleAPI
import dan200.computercraft.shared.turtle.core.TurtleAccessInternal
import dan200.computercraft.shared.turtle.core.TurtleCraftCommand
import dan200.computercraft.shared.turtle.items.TurtleItem
import dan200.computercraft.shared.util.WaterloggableHelpers
import dan200.computercraft.test.core.assertArrayEquals
import dan200.computercraft.test.core.computer.ScriptTaskContext
import dan200.computercraft.test.core.computer.getApi
import dan200.computercraft.test.shared.ItemStackMatcher.isStack
import net.minecraft.core.BlockPos
import net.minecraft.core.registries.Registries
import net.minecraft.gametest.framework.GameTest
import net.minecraft.gametest.framework.GameTestHelper
import net.minecraft.resources.ResourceLocation
import net.minecraft.world.entity.EntityType
import net.minecraft.world.entity.item.PrimedTnt
import net.minecraft.world.item.BlockItem
import net.minecraft.world.item.ItemStack
import net.minecraft.world.item.Items
import net.minecraft.world.item.enchantment.Enchantments
import net.minecraft.world.level.block.BeehiveBlock
import net.minecraft.world.level.block.Blocks
import net.minecraft.world.level.block.ComposterBlock
import net.minecraft.world.level.block.FenceBlock
import net.minecraft.world.level.block.entity.BlockEntityType
import net.minecraft.world.level.block.state.properties.BlockStateProperties
import org.hamcrest.MatcherAssert.assertThat
import org.hamcrest.Matchers.array
import org.hamcrest.Matchers.instanceOf
import org.junit.jupiter.api.Assertions.*
import java.util.*
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.time.Duration.Companion.milliseconds

class Turtle_Test {
    @GameTest
    fun Unequip_refreshes_peripheral(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            assertEquals(listOf("modem"), getApi<PeripheralAPI>().getType("right"), "Starts with a modem")
            turtle.equipRight().await()
            assertEquals(listOf("drive"), getApi<PeripheralAPI>().getType("right"), "Unequipping gives a drive")
        }
    }

    /**
     * Checks turtles can sheer sheep (and drop items)
     *
     * @see [#537](https://github.com/cc-tweaked/CC-Tweaked/issues/537)
     */
    @GameTest
    fun Shears_sheep(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.placeDown(Optional.empty()).awaitValue()
                .assertResult(true, message = "Shears the sheep")

            assertEquals("minecraft:white_wool", getTurtleItemDetail(2)["name"])
        }
    }

    /**
     * Checks turtles can place lava.
     *
     * @see [#518](https://github.com/cc-tweaked/CC-Tweaked/issues/518)
     */
    @GameTest
    fun Place_lava(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.placeDown(Optional.empty()).awaitValue()
                .assertResult(true, message = "Placed lava")
        }
        thenExecute { helper.assertBlockPresent(Blocks.LAVA, BlockPos(2, 2, 2)) }
    }

    /**
     * Checks turtles can write to signs.
     *
     * @see [#1611](https://github.com/cc-tweaked/CC-Tweaked/issues/1611)
     */
    @GameTest
    fun Place_sign(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.of("Test\nmessage")).awaitValue()
                .assertResult(true, message = "Placed sign")
        }
        thenExecute {
            val sign = helper.getBlockEntity(BlockPos(2, 2, 1), BlockEntityType.SIGN)
            val lines = listOf("", "Test", "message", "")
            for ((i, line) in lines.withIndex()) {
                assertEquals(line, sign.frontText.getMessage(i, false).string, "Line $i")
            }
        }
    }

    /**
     * Checks that turtles can place boats. These are not a [BlockItem], and so behave slightly differently.
     *
     * See [ComputerCraftTags.Items.TURTLE_CAN_PLACE].
     */
    @GameTest
    fun Place_boat(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.placeDown(Optional.empty()).awaitValue().assertResult(true, message = "Placed boat")
        }
        thenExecute { helper.assertEntityPresent(EntityType.BOAT) }
    }

    /**
     * Checks that turtles can place items into composters.
     *
     * See [ComputerCraftTags.Blocks.TURTLE_CAN_USE].
     */
    @GameTest
    fun Place_into_composter(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.empty()).awaitValue().assertResult(true, message = "Placed pumpkin pie")
            turtle.getItemDetail(context, Optional.empty(), Optional.empty()).await().assertArrayEquals(
                mapOf("name" to "minecraft:pumpkin_pie", "count" to 1),
            )
        }
        thenExecute {
            helper.assertBlockHas(BlockPos(2, 2, 2), ComposterBlock.LEVEL, 2)
        }
    }

    /**
     * Checks that turtles cannot place items into non-adjacent blocks.
     *
     * See [ComputerCraftTags.Blocks.TURTLE_CAN_USE].
     */
    @GameTest
    fun Place_into_composter_non_adjacent(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.empty()).awaitValue()
                .assertResult(false, "Cannot place item here", message = "Failed to place item")
        }
        thenExecute {
            helper.assertBlockHas(BlockPos(2, 2, 3), ComposterBlock.LEVEL, 0)
        }
    }

    /**
     * Checks that turtles can place bottles into beehives.
     *
     * See [ComputerCraftTags.Blocks.TURTLE_CAN_USE].
     */
    @GameTest
    fun Place_into_beehive(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.empty()).awaitValue().assertResult(true, message = "Placed pumpkin pie")
            turtle.getItemDetail(context, Optional.of(1), Optional.empty()).await().assertArrayEquals(
                mapOf("name" to "minecraft:glass_bottle", "count" to 63),
            )
            turtle.getItemDetail(context, Optional.of(2), Optional.empty()).await().assertArrayEquals(
                mapOf("name" to "minecraft:honey_bottle", "count" to 1),
            )
        }
        thenExecute {
            helper.assertBlockHas(BlockPos(2, 2, 2), BeehiveBlock.HONEY_LEVEL, 0)
        }
    }

    /**
     * Checks that turtles cannot use arbitrary blocks with `place()`.
     *
     * See [ComputerCraftTags.Blocks.TURTLE_CAN_USE].
     */
    @GameTest
    fun Place_does_not_use(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.empty()).awaitValue()
                .assertResult(false, "Cannot place block here", message = "Failed to place item")
        }
    }

    /**
     * Checks that calling [net.minecraft.world.item.Item.use] will not place blocks too far away.
     *
     * This is caused by items using [net.minecraft.world.item.Item.getPlayerPOVHitResult] to perform a ray trace, which
     * ignores turtle's reduced reach distance.
     *
     * @see [#1497](https://github.com/cc-tweaked/CC-Tweaked/issues/1497)
     */
    @GameTest
    fun Place_use_reach_limit(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.placeDown(Optional.empty()).awaitValue()
                .assertResult(true, message = "Placed water")
        }
        thenExecute {
            helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 2))
            helper.assertBlockHas(BlockPos(2, 5, 2), BlockStateProperties.WATERLOGGED, true)
        }
    }

    /**
     * Checks turtles can place when waterlogged.
     *
     * @see [#385](https://github.com/cc-tweaked/CC-Tweaked/issues/385)
     */
    @GameTest
    fun Place_waterlogged(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.empty()).awaitValue()
                .assertResult(true, message = "Placed oak fence")
        }
        thenExecute {
            helper.assertBlockIs(BlockPos(2, 2, 2)) { it.block == Blocks.OAK_FENCE && it.getValue(FenceBlock.WATERLOGGED) }
        }
    }

    /**
     * Checks turtles can pick up lava
     *
     * @see [#297](https://github.com/cc-tweaked/CC-Tweaked/issues/297)
     */
    @GameTest
    fun Gather_lava(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.placeDown(Optional.empty()).awaitValue()
                .assertResult(true, message = "Picked up lava")

            assertEquals("minecraft:lava_bucket", getTurtleItemDetail()["name"])
        }
        thenExecute { helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 2)) }
    }

    /**
     * Checks turtles can hoe dirt.
     *
     * @see [#258](https://github.com/cc-tweaked/CC-Tweaked/issues/258)
     */
    @GameTest
    fun Hoe_dirt(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.dig(Optional.empty()).awaitValue().assertResult(true, message = "Dug with hoe") }
        thenExecute { helper.assertBlockPresent(Blocks.FARMLAND, BlockPos(1, 2, 1)) }
    }

    /**
     * Checks turtles can hoe dirt with a block gap below them.
     *
     * @see [#1527](https://github.com/cc-tweaked/CC-Tweaked/issues/1527)
     */
    @GameTest
    fun Hoe_dirt_below(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.digDown(Optional.empty()).awaitValue().assertResult(true, message = "Dug with hoe") }
        thenExecute { helper.assertBlockPresent(Blocks.FARMLAND, BlockPos(1, 1, 1)) }
    }

    /**
     * Checks turtles cannot hoe dirt with a block gap in front of them.
     */
    @GameTest
    fun Hoe_dirt_distant(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.dig(Optional.empty()).awaitValue()
                .assertResult(false, "Nothing to dig here", message = "Dug with hoe")
        }
        thenExecute { helper.assertBlockPresent(Blocks.DIRT, BlockPos(1, 2, 2)) }
    }

    /**
     * Checks turtles break cables in two parts.
     */
    @GameTest
    fun Break_cable(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.dig(Optional.empty()).await() }
        thenExecute {
            helper.assertBlockIs(BlockPos(2, 2, 3)) {
                it.block == ModRegistry.Blocks.CABLE.get() && !it.getValue(CableBlock.CABLE) && it.getValue(CableBlock.MODEM) == CableModemVariant.DownOff
            }

            helper.assertContainerExactly(BlockPos(2, 2, 2), listOf(ItemStack(ModRegistry.Items.CABLE.get())))
        }
        thenOnComputer { turtle.dig(Optional.empty()).awaitValue().assertResult(true) }
        thenExecute {
            helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 3))

            helper.assertContainerExactly(
                BlockPos(2, 2, 2),
                listOf(
                    ItemStack(ModRegistry.Items.CABLE.get()),
                    ItemStack(ModRegistry.Items.WIRED_MODEM.get()),
                ),
            )
        }
    }

    /**
     * Digging using a pickaxe with `{"consumesDurability": "always"}`, consumes durability.
     */
    @GameTest
    fun Dig_consume_durability(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.dig(Optional.empty()).await() }
        thenExecute {
            helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 3))
            helper.assertContainerExactly(BlockPos(2, 2, 2), listOf(ItemStack(Items.COBBLESTONE)))

            val turtle = helper.getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get()).access
            val upgrade = turtle.getUpgrade(TurtleSide.LEFT)
            assertEquals(
                helper.level.registryAccess().registryOrThrow(ITurtleUpgrade.REGISTRY)
                    .get(ResourceLocation.fromNamespaceAndPath("cctest", "wooden_pickaxe")),
                upgrade,
                "Upgrade is a wooden pickaxe",
            )

            val item = ItemStack(Items.WOODEN_PICKAXE)
            item.damageValue = 1
            helper.assertUpgradeItem(item, turtle.getUpgradeWithData(TurtleSide.LEFT)!!)
        }
    }

    /**
     * Digging using a pickaxe with `{"consumesDurability": "always"}` and no durability removes the tool.
     */
    @GameTest
    fun Dig_breaks_tool(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.dig(Optional.empty()).await() }
        thenExecute {
            helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 3))
            helper.assertContainerExactly(BlockPos(2, 2, 2), listOf(ItemStack(Items.COBBLESTONE)))

            val turtle = helper.getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get()).access
            val upgrade = turtle.getUpgrade(TurtleSide.LEFT)
            assertEquals(null, upgrade, "Upgrade broke")

            helper.assertUpgradeItem(
                ItemStack(Items.WOODEN_PICKAXE),
                UpgradeData.ofDefault(
                    helper.level.registryAccess().registryOrThrow(ITurtleUpgrade.REGISTRY)
                        .getHolder(ResourceLocation.fromNamespaceAndPath("cctest", "wooden_pickaxe")).orElseThrow(),
                ),
            )
        }
    }

    /**
     * Digging using a silk-touch enchanted pickaxe with `{"consumesDurability": "when_enchanted"}`, consumes durability
     * uses silk touch.
     */
    @GameTest
    fun Dig_enchanted_consume_durability(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.dig(Optional.empty()).await() }
        thenExecute {
            helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 3))
            helper.assertContainerExactly(BlockPos(2, 2, 2), listOf(ItemStack(Items.STONE)))

            val turtle = helper.getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get()).access
            val upgrade = turtle.getUpgrade(TurtleSide.LEFT)
            assertEquals(
                helper.level.registryAccess().registryOrThrow(ITurtleUpgrade.REGISTRY)
                    .get(ResourceLocation.fromNamespaceAndPath("cctest", "netherite_pickaxe")),
                upgrade,
                "Upgrade is a netherite pickaxe",
            )

            val item = ItemStack(Items.NETHERITE_PICKAXE)
            item.damageValue = 1
            item.enchant(
                helper.level.registryAccess().registryOrThrow(Registries.ENCHANTMENT)
                    .getHolderOrThrow(Enchantments.SILK_TOUCH),
                1,
            )

            helper.assertUpgradeItem(item, turtle.getUpgradeWithData(TurtleSide.LEFT)!!)
        }
    }

    private fun GameTestHelper.assertUpgradeItem(expected: ItemStack, upgrade: UpgradeData<ITurtleUpgrade>) {
        if (!ItemStack.matches(expected, upgrade.upgradeItem)) {
            fail("Invalid upgrade item\n Expected => ${expected.componentsPatch}\n    Actual => ${upgrade.upgradeItem.componentsPatch}")
        }

        if (!ItemStack.matches(ItemStack(expected.item), upgrade.upgrade().craftingItem)) {
            fail("Original upgrade item has changed (is now ${upgrade.upgrade().craftingItem})")
        }
    }

    /**
     * Checks turtles can place monitors
     *
     * @see [#691](https://github.com/cc-tweaked/CC-Tweaked/issues/691)
     */
    @GameTest
    fun Place_monitor(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.place(Optional.empty()).awaitValue()
                .assertResult(true, message = "Block was placed")
        }
        thenIdle(1)
        thenExecute { helper.assertBlockHas(BlockPos(1, 2, 3), MonitorBlock.STATE, MonitorEdgeState.LR) }
    }

    /**
     * Checks turtles can place into composters. These are non-typical inventories, so
     * worth testing.
     */
    @GameTest
    fun Use_composters(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.dropDown(Optional.empty()).awaitValue()
                .assertResult(true, message = "Item was dropped")
            assertEquals(63, turtle.getItemCount(Optional.of(1)), "Only dropped one item")
        }
    }

    /**
     * Checks turtles can be cleaned in cauldrons.
     */
    @GameTest
    fun Cleaned_with_cauldrons(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            val details = getTurtleItemDetail(1, true)
            turtle.place(Optional.empty()).awaitValue()
                .assertResult(true, message = "Used item on cauldron")
            val newDetails = getTurtleItemDetail(1, true)

            assertEquals("computercraft:turtle_normal", newDetails["name"], "Still a turtle")
            assertNotEquals(details["nbt"], newDetails["nbt"], "Colour should have changed")
        }
    }

    /**
     * Checks turtles can use [VanillaDetailRegistries.ITEM_STACK] by getting details for a printed page.
     */
    @GameTest
    fun Item_detail_provider(helper: GameTestHelper) = helper.sequence {
        // Register a dummy provider for printout items
        thenExecute {
            VanillaDetailRegistries.ITEM_STACK.addProvider(
                object :
                    ComponentDetailProvider<PrintoutData>("printout", ModRegistry.DataComponents.PRINTOUT.get()) {
                    override fun provideComponentDetails(data: MutableMap<in String, Any>, component: PrintoutData) {
                        data["pages"] = component.pages()
                    }
                },
            )
        }
        thenOnComputer {
            val details = getTurtleItemDetail(detailed = true)
            assertEquals(mapOf("pages" to 1), details["printout"]) {
                "Printout information is returned (whole map is $details)"
            }
        }
    }

    /**
     * Advanced turtles resist all explosions but normal ones don't.
     */
    @GameTest
    fun Resists_explosions(helper: GameTestHelper) = helper.sequence {
        thenExecute {
            val pos = helper.absolutePos(BlockPos(2, 2, 2))
            val tnt = PrimedTnt(helper.level, pos.x + 0.5, pos.y + 1.0, pos.z + 0.5, null)
            tnt.fuse = 1
            helper.level.addFreshEntity(tnt)
        }
        thenWaitUntil { helper.assertEntityNotPresent(EntityType.TNT) }
        thenExecute {
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_ADVANCED.get(), BlockPos(2, 2, 2))
            helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 1))
        }
    }

    /**
     * Turtles resist mob explosions
     */
    @GameTest
    fun Resists_entity_explosions(helper: GameTestHelper) = helper.sequence {
        thenExecute { helper.getEntity(EntityType.CREEPER).ignite() }
        thenWaitUntil { helper.assertEntityNotPresent(EntityType.CREEPER) }
        thenExecute {
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_ADVANCED.get(), BlockPos(2, 2, 2))
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 1))
        }
    }

    /**
     * Test calling `turtle.drop` into an inventory.
     */
    @GameTest
    fun Drop_into_chest(helper: GameTestHelper) = helper.sequence {
        val turtlePos = BlockPos(2, 2, 2)
        val chest = BlockPos(2, 2, 3)

        thenOnComputer {
            turtle.drop(Optional.of(32)).awaitValue()
                .assertResult(true, message = "Could not drop items")
        }
        thenExecute {
            helper.assertContainerExactly(turtlePos, listOf(ItemStack(Blocks.DIRT, 32), ItemStack.EMPTY, ItemStack(Blocks.DIRT, 32)))
            helper.assertContainerExactly(chest, listOf(ItemStack(Blocks.DIRT, 48)))
        }
    }

    /**
     * Test calling `turtle.drop` into an entity with an inventory
     */
    @GameTest
    fun Drop_into_entity(helper: GameTestHelper) = helper.sequence {
        // When running /test runthis, the previous items pop from the chest. Remove them first!
        thenExecute { for (it in helper.getEntities(EntityType.ITEM)) it.discard() }

        thenOnComputer {
            turtle.drop(Optional.of(32)).awaitValue()
                .assertResult(true, message = "Could not drop items")
        }
        thenExecute {
            helper.assertContainerExactly(BlockPos(2, 2, 2), listOf(ItemStack(Blocks.DIRT, 32)))
            helper.assertContainerExactly(helper.getEntity(EntityType.CHEST_MINECART), listOf(ItemStack(Blocks.DIRT, 48)))
            helper.assertEntityNotPresent(EntityType.ITEM)
        }
    }

    /**
     * Test calling `turtle.refuel` on solid fuels (coal, blaze powder)
     */
    @GameTest
    fun Refuel_basic(helper: GameTestHelper) = helper.sequence {
        val turtlePos = BlockPos(2, 2, 2)

        // Test refueling from slot 1 with no limit.
        thenOnComputer {
            assertEquals(0, turtle.energy)
            turtle.refuel(Optional.empty()).awaitValue().assertResult(true)
            assertEquals(2 * COAL_ENERGY, turtle.energy)
        }
        thenExecute {
            helper.assertContainerExactly(turtlePos, listOf(ItemStack.EMPTY, ItemStack(Items.BLAZE_ROD, 2)))
        }

        // Test refueling from slot 2 with a limit.
        thenOnComputer {
            // select is a main-thread function, so must be run there rather than called directly.
            context.executeMainThreadTask { turtle.select(2) }.await()
            turtle.refuel(Optional.of(1)).awaitValue().assertResult(true)
            assertEquals(2 * COAL_ENERGY + BLAZE_POWDER_ENERGY, turtle.energy)
        }
        thenExecute {
            helper.assertContainerExactly(turtlePos, listOf(ItemStack.EMPTY, ItemStack(Items.BLAZE_ROD, 1)))
        }
    }

    /**
     * Test calling `turtle.refuel` on non-fuels
     */
    @GameTest
    fun Refuel_fail(helper: GameTestHelper) = helper.sequence {
        val turtlePos = BlockPos(2, 2, 2)

        thenOnComputer {
            assertEquals(0, turtle.energy)
            turtle.refuel(Optional.empty()).awaitValue().assertResult(false, "Items not combustible")
            assertEquals(0, turtle.energy)
        }
        thenExecute {
            helper.assertContainerExactly(turtlePos, listOf(ItemStack(Items.DIRT, 32)))
        }
    }

    /**
     * Test calling `turtle.refuel` with a bucket of lava
     */
    @GameTest
    fun Refuel_container(helper: GameTestHelper) = helper.sequence {
        val turtlePos = BlockPos(2, 2, 2)

        // Test refueling from slot 1 with no limit.
        thenOnComputer {
            assertEquals(0, turtle.energy)
            turtle.refuel(Optional.empty()).awaitValue().assertResult(true)
            assertEquals(LAVA_BUCKET_ENERGY, turtle.energy)
        }
        thenExecute {
            helper.assertContainerExactly(turtlePos, listOf(ItemStack(Items.BUCKET)))
        }
    }

    /**
     * Test moving a turtle forwards preserves the turtle's inventory.
     *
     * @see [#1276](https://github.com/cc-tweaked/CC-Tweaked/pull/1276)
     */
    @GameTest
    fun Move_preserves_state(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.forward().awaitValue().assertResult(true, message = "Turtle moved forward") }
        thenExecute {
            helper.assertContainerExactly(BlockPos(2, 2, 3), listOf(ItemStack(Items.DIRT, 32)))

            val turtle = helper.getBlockEntity(BlockPos(2, 2, 3), ModRegistry.BlockEntities.TURTLE_NORMAL.get())
            assertEquals(1, turtle.computerID)
            assertEquals("turtle_test.move_preserves_state", turtle.label)
            assertEquals(79 * Config.turtleEnergyPerMovement, turtle.access.energyLevel)

            helper.assertEntityNotPresent(EntityType.ITEM)
        }
    }

    /**
     * Test turtles are not obstructed by plants and instead replace them.
     */
    @GameTest
    fun Move_replace(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.forward().awaitValue().assertResult(true, message = "Turtle moved forward") }
        thenExecute { helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 3)) }
    }

    /**
     * Test turtles become waterlogged when moving through liquid.
     */
    @GameTest
    fun Move_water(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.forward().awaitValue().assertResult(true, message = "Turtle moved forward") }
        thenExecute {
            // Assert we're waterlogged.
            helper.assertBlockHas(BlockPos(2, 2, 2), WaterloggableHelpers.WATERLOGGED, true)
        }
        thenOnComputer { turtle.forward().awaitValue().assertResult(true, message = "Turtle moved forward") }
        thenExecute {
            // Assert we're no longer waterlogged and we've left a source block.
            helper.assertBlockIs(BlockPos(2, 2, 2)) { it.block == Blocks.WATER && it.fluidState.isSource }
            helper.assertBlockHas(BlockPos(2, 2, 3), WaterloggableHelpers.WATERLOGGED, false)
        }
    }

    /**
     * Test turtles can't move through solid blocks.
     */
    @GameTest
    fun Move_obstruct(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.forward().awaitValue().assertResult(false, "Movement obstructed") }
        thenExecute {
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 2))
            helper.assertBlockPresent(Blocks.DIRT, BlockPos(2, 2, 3))
        }
    }

    /**
     * Test turtles can push entities.
     */
    @GameTest
    fun Move_push_entity(helper: GameTestHelper) = helper.sequence {
        thenOnComputer { turtle.up().awaitValue().assertResult(true) }
        thenIdle(9)
        thenExecute {
            // The turtle has moved up
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 3, 2))

            // As has the villager
            val pos = BlockPos(2, 4, 2)
            helper.assertEntityPresent(EntityType.VILLAGER, pos)

            val villager = helper.getEntity(EntityType.VILLAGER)
            val expectedY = helper.absolutePos(pos).y - 0.125
            if (villager.y < expectedY) helper.fail("Expected villager at y>=$expectedY, but at ${villager.y}", pos)
        }
    }

    /**
     * Test a turtle can attack an entity and capture its drops.
     */
    @GameTest
    fun Attack_entity(helper: GameTestHelper) = helper.sequence {
        val turtlePos = BlockPos(2, 2, 2)
        thenOnComputer {
            turtle.attack(Optional.empty()).awaitValue().assertResult(true, message = "Attacked entity")
        }
        thenExecute {
            helper.assertEntityNotPresent(EntityType.SHEEP)
            val count = helper.getBlockEntity(turtlePos, ModRegistry.BlockEntities.TURTLE_NORMAL.get())
                .countItem(Items.WHITE_WOOL)
            if (count == 0) helper.fail("Expected turtle to have white wool", turtlePos)
        }
    }

    /**
     * Test a turtle can be destroyed while performing an action.
     *
     * @see [#585](https://github.com/cc-tweaked/CC-Tweaked/issues/585)
     */
    @GameTest
    fun Attack_entity_destroy(helper: GameTestHelper) = helper.sequence {
        thenStartComputer { turtle.attack(Optional.empty()) }
        thenWaitUntil { helper.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 2)) }
    }

    /**
     * Ensure a turtle never sees itself as a peripheral.
     *
     * @see <https://github.com/dan200/ComputerCraft/issues/131>
     */
    @GameTest
    fun No_ghost_peripheral(helper: GameTestHelper) = helper.sequence {
        val events = mutableListOf<String>()
        thenOnComputer {
            for (i in 0 until 3) {
                if ((i % 2) == 0) turtle.up() else turtle.down()

                do {
                    val event = pullEvent()[0] as String
                    events.add(event)
                } while (event != "task_complete")
            }
        }
    }

    /**
     * Ensure a turtle attaches and detaches peripherals as it moves.
     */
    @GameTest
    fun Peripheral_change(helper: GameTestHelper) = helper.sequence {
        val testInfo = (helper as GameTestHelperAccessor).testInfo as GameTestInfoAccessor

        val events = CopyOnWriteArrayList<Pair<String, String>>()
        var running = false
        thenStartComputer("listen") {
            running = true
            while (true) {
                val event = pullEvent()
                TestHooks.LOG.info("[{}] Got event {} at tick {}", testInfo, event[0], testInfo.`computercraft$getTick`())
                if (event[0] == "peripheral" || event[0] == "peripheral_detach") {
                    events.add((event[0] as String) to (event[1] as String))
                }
            }
        }
        thenOnComputer("turtle") {
            while (!running) sleep(10.milliseconds)

            turtle.forward().awaitValue().assertResult(true, message = "Moved turtle forward")
            turtle.back().awaitValue().assertResult(true, message = "Moved turtle forward")
            TestHooks.LOG.info("[{}] Finished turtle at {}", testInfo, testInfo.`computercraft$getTick`())
        }
        thenWaitUntil {
            val expected = listOf(
                "peripheral_detach" to "right",
                "peripheral" to "right",
            )

            if (events != expected) helper.fail("Expected $expected, but received $events")
        }
    }

    /**
     * A JS program's `turtle.forward()` suspends until the standard `task_complete` event, and returns a `Result`.
     *
     * @see [average-web-dev/CC-Rhino#15](https://github.com/average-web-dev/CC-Rhino/issues/15)
     */
    @GameTest(timeoutTicks = Timeouts.COMPUTER_TIMEOUT)
    fun Move_task_complete(helper: GameTestHelper) = helper.sequence {
        thenComputerOk()
        thenExecute {
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 2))
            helper.assertBlockPresent(Blocks.DIRT, BlockPos(2, 2, 3))
        }
    }

    /**
     * `require('turtle/promises')` returns promises settled through `task_complete`, `async.unwrap`/`async.run` bridge
     * the blocking and the promise style, and the blocking form throws a clear error inside async code without running
     * (the turtle ends where [Move_task_complete] leaves it).
     *
     * @see [average-web-dev/CC-Rhino#35](https://github.com/average-web-dev/CC-Rhino/issues/35)
     */
    @GameTest(timeoutTicks = Timeouts.COMPUTER_TIMEOUT)
    fun Move_promises(helper: GameTestHelper) = helper.sequence {
        thenComputerOk()
        thenExecute {
            helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 2))
            helper.assertBlockPresent(Blocks.DIRT, BlockPos(2, 2, 3))
        }
    }

    /**
     * Timers and redstone events are dispatched to a JS program's listeners while a turtle command waits for a move
     * to finish animating.
     */
    @GameTest(timeoutTicks = Timeouts.COMPUTER_TIMEOUT)
    fun Move_dispatches_events(helper: GameTestHelper) = helper.sequence {
        // The turtle has made its first move, and is now waiting for its animation to finish.
        thenComputerOk(marker = "moving")
        thenExecute { helper.setBlock(BlockPos(1, 2, 2), Blocks.REDSTONE_BLOCK) }
        thenComputerOk()
        thenExecute { helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 3)) }
    }

    /**
     * An exception thrown by a turtle command surfaces as a JS error, rather than hanging the program (or crashing the
     * server).
     */
    @GameTest(timeoutTicks = Timeouts.COMPUTER_TIMEOUT)
    fun Command_error(helper: GameTestHelper) = helper.sequence { thenComputerOk() }

    /**
     * Terminating (Ctrl+T) a program while a turtle command is in flight makes that call throw `Terminated`. The
     * queued command still runs.
     */
    @GameTest(timeoutTicks = Timeouts.COMPUTER_TIMEOUT)
    fun Terminate_command(helper: GameTestHelper) = helper.sequence {
        thenComputerOk()
        // Moved forward twice (the second move was terminated, but still ran), then back once.
        thenExecute { helper.assertBlockPresent(ModRegistry.Blocks.TURTLE_NORMAL.get(), BlockPos(2, 2, 1)) }
    }

    /**
     * A turtle accepts energy pushed in by its neighbour at the per-side charge rate, and none through a side whose
     * charge rate is 0.
     *
     * In the energy tests, the neighbouring energy storage is another (switched off) turtle, which is exposed as Forge
     * Energy on NeoForge and Tech Reborn Energy on Fabric.
     */
    @GameTest
    fun Energy_charge_rate(helper: GameTestHelper) = helper.sequence {
        thenExecute { helper.getNeighbourTurtle().setDischargeRate(ComputerSide.BACK, 1000) }
        thenOnComputer {
            setChargeRate(ComputerSide.FRONT, 0)
            assertEquals(0, turtle.getChargeRate(ComputerSide.FRONT))
            assertEquals(Int.MAX_VALUE, turtle.getChargeRate(ComputerSide.BACK), "Other sides are unchanged")

            sleep(100.milliseconds) // Let any tick which used the old rate finish.
            val blocked = turtle.energy
            sleep(200.milliseconds)
            assertEquals(blocked, turtle.energy, "No energy through a disabled side")

            setChargeRate(ComputerSide.FRONT, 50)
            val before = turtle.energy
            sleep(200.milliseconds)
            val gained = turtle.energy - before
            assertTrue(gained > 0 && gained % 50 == 0, "Charged at 50 FE/t (gained $gained FE)")

            setChargeRate(ComputerSide.FRONT, 0)
        }
        thenExecute {
            val total = helper.getTestTurtle().energyLevel + helper.getNeighbourTurtle().energyLevel
            assertEquals(20000, total, "Energy is conserved")
        }
    }

    /**
     * A turtle with a discharge rate actively pushes energy into its neighbour, at that side's rate.
     */
    @GameTest
    fun Energy_push(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            assertEquals(0, turtle.getDischargeRate(ComputerSide.FRONT), "Discharging is off by default")
            setDischargeRate(ComputerSide.FRONT, 100)
            setDischargeRate(ComputerSide.LEFT, 100) // Nothing to the left, so this loses no energy.
            assertEquals(100, turtle.getDischargeRate(ComputerSide.FRONT))
            assertEquals(0, turtle.getDischargeRate(ComputerSide.BACK), "Other sides are unchanged")

            sleep(200.milliseconds)
            setDischargeRate(ComputerSide.FRONT, 0)
            sleep(100.milliseconds)

            val pushed = 10000 - turtle.energy
            assertTrue(pushed > 0 && pushed % 100 == 0, "Pushed at 100 FE/t (pushed $pushed FE)")
        }
        thenExecute {
            val pushed = 10000 - helper.getTestTurtle().energyLevel
            assertEquals(pushed, helper.getNeighbourTurtle().energyLevel, "Pushed energy arrived in the neighbour")
        }
    }

    /**
     * `turtle.transferEnergy` is capped by [Config.turtleMaxDischargeRate].
     *
     * @see [average-web-dev/CC-Rhino#21](https://github.com/average-web-dev/CC-Rhino/issues/21)
     */
    @GameTest(batch = "turtle_energy_discharge_cap")
    fun Energy_transfer_caps(helper: GameTestHelper) = helper.sequence {
        thenExecute { helper.overrideConfig(Config::turtleMaxDischargeRate, 150) }
        thenOnComputer {
            assertEquals(150, turtle.maxDischargeRate)
            assertEquals(100, transferEnergy(ComputerSide.FRONT, 100), "Below the cap")
            assertEquals(150, transferEnergy(ComputerSide.FRONT, 1000), "Capped by turtleMaxDischargeRate")
            assertEquals(750, turtle.energy)

            assertEquals(0, transferEnergy(ComputerSide.BACK, 100), "No energy storage behind")
            assertEquals(0, absorbEnergy(ComputerSide.FRONT, 100), "Neighbour does not discharge")
        }
        thenExecute {
            assertEquals(750, helper.getTestTurtle().energyLevel)
            assertEquals(250, helper.getNeighbourTurtle().energyLevel)
        }
    }

    /**
     * `turtle.absorbEnergy` is capped by [Config.turtleMaxChargeRate].
     *
     * @see [average-web-dev/CC-Rhino#21](https://github.com/average-web-dev/CC-Rhino/issues/21)
     */
    @GameTest(batch = "turtle_energy_charge_cap")
    fun Energy_absorb_caps(helper: GameTestHelper) = helper.sequence {
        thenExecute { helper.overrideConfig(Config::turtleMaxChargeRate, 200) }
        // Stop the neighbour pushing energy into us, so we only measure what absorbEnergy pulls.
        thenOnComputer { setChargeRate(ComputerSide.FRONT, 0) }
        thenExecute { helper.getNeighbourTurtle().setDischargeRate(ComputerSide.BACK, Int.MAX_VALUE) }
        thenOnComputer {
            assertEquals(200, turtle.maxChargeRate)
            assertEquals(50, absorbEnergy(ComputerSide.FRONT, 50), "Below the cap")
            assertEquals(200, absorbEnergy(ComputerSide.FRONT, 1000), "Capped by turtleMaxChargeRate")
            assertEquals(250, turtle.energy)
        }
        thenExecute {
            assertEquals(250, helper.getTestTurtle().energyLevel)
            assertEquals(750, helper.getNeighbourTurtle().energyLevel)
        }
    }

    /**
     * When turtles don't need fuel, they never exchange energy with their neighbours, as their energy is never
     * consumed.
     *
     * @see [average-web-dev/CC-Rhino#21](https://github.com/average-web-dev/CC-Rhino/issues/21)
     */
    @GameTest(batch = "turtle_energy_no_fuel")
    fun Energy_no_fuel(helper: GameTestHelper) = helper.sequence {
        thenExecute {
            helper.overrideConfig(Config::turtlesNeedFuel, false)
            helper.getNeighbourTurtle().setDischargeRate(ComputerSide.BACK, 1000)
        }
        thenOnComputer {
            assertFalse(turtle.isEnergyNeeded)
            assertEquals(0, transferEnergy(ComputerSide.FRONT, 100), "transferEnergy moves nothing")
            assertEquals(0, absorbEnergy(ComputerSide.FRONT, 100), "absorbEnergy moves nothing")

            setDischargeRate(ComputerSide.FRONT, 1000)
            sleep(200.milliseconds)
        }
        thenExecute {
            assertEquals(1000, helper.getTestTurtle().energyLevel, "Turtle neither pushed nor received energy")
            assertEquals(1000, helper.getNeighbourTurtle().energyLevel, "Neighbour neither pushed nor received energy")
        }
    }

    /**
     * Loads a structure created on an older version of the game, and checks that data fixers have been applied.
     */
    @GameTest
    fun Data_fixers(helper: GameTestHelper) = helper.sequence {
        thenExecute {
            val overlay = helper.level.registryAccess().registryOrThrow(TurtleOverlay.REGISTRY)
                .get(ResourceLocation.fromNamespaceAndPath(ComputerCraftAPI.MOD_ID, "trans_flag"))!!
            val upgrade = helper.level.registryAccess().registryOrThrow(ITurtleUpgrade.REGISTRY)
                .get(ResourceLocation.withDefaultNamespace("diamond_pickaxe"))!!

            val turtleBe = helper.getBlockEntity(BlockPos(1, 2, 1), ModRegistry.BlockEntities.TURTLE_NORMAL.get())
            assertEquals(overlay, turtleBe.overlay)
            assertEquals(upgrade, turtleBe.getUpgrade(TurtleSide.LEFT))

            val turtleItem = turtleBe.getItem(0)
            assertEquals(overlay, TurtleItem.getOverlay(turtleItem))
            assertEquals(upgrade, TurtleItem.getUpgrade(turtleItem, TurtleSide.LEFT))
        }
    }

    /**
     * `turtle.suck` only pulls for the current side.
     */
    @GameTest
    fun Sided_suck(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.suckUp(Optional.empty()).awaitValue().assertResult(true)
            turtle.getItemDetail(context, Optional.empty(), Optional.empty()).await().assertArrayEquals(
                mapOf("name" to "minecraft:iron_ingot", "count" to 8),
            )

            turtle.suckUp(Optional.empty()).awaitValue().assertResult(false, "No items to take")
        }
    }

    /**
     * `turtle.drop` only inserts for the current side.
     */
    @GameTest
    fun Sided_drop(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.dropDown(Optional.empty()).awaitValue().assertResult(true)
            turtle.getItemDetail(context, Optional.empty(), Optional.empty()).await().assertArrayEquals(
                mapOf("name" to "minecraft:coal", "count" to 8),
            )

            turtle.dropDown(Optional.empty()).awaitValue().assertResult(false, "No space for items")
        }
    }

    /**
     * `turtle.craft` works as expected
     */
    @GameTest
    fun Craft(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            callPeripheral("left", "craft", 1).assertArrayEquals(ScriptResult.succeed())
        }
        thenExecute {
            helper.assertContainerExactly(
                BlockPos(2, 2, 2),
                listOf(
                    ItemStack(Items.DIAMOND), ItemStack(Items.DIAMOND), ItemStack(Items.DIAMOND), ItemStack(Items.DIAMOND_PICKAXE),
                    ItemStack.EMPTY, ItemStack(Items.STICK), ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack(Items.STICK), ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ),
            )
        }
    }

    /**
     * `turtle.craft` works on shapeless recipes
     *
     * @see [#2094](https://github.com/cc-tweaked/CC-Tweaked/issues/2094)
     */
    @GameTest
    fun Craft_shapeless(helper: GameTestHelper) = helper.sequence {
        thenExecute {
            val turtle = helper.getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get())
            assertTrue(TurtleCraftCommand(64).execute(turtle.access).isSuccess, "Crafting succeeded")

            helper.assertContainerExactly(
                BlockPos(2, 2, 2),
                listOf(
                    ItemStack(Items.ENDER_EYE, 1), ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ),
            )
        }
    }

    /**
     * `turtle.craft` leaves a remainder
     *
     * @see [#2007](https://github.com/cc-tweaked/CC-Tweaked/issues/2007)
     */
    @GameTest
    fun Craft_remainder(helper: GameTestHelper) = helper.sequence {
        thenExecute {
            val turtle = helper.getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get())
            assertTrue(TurtleCraftCommand(1).execute(turtle.access).isSuccess, "Crafting succeeded")

            val turtleStack = ItemStack(ModRegistry.Items.TURTLE_NORMAL.get())

            helper.assertContainerExactly(
                BlockPos(2, 2, 2),
                listOf(
                    turtleStack, ItemStack(Items.WET_SPONGE), ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                    ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ),
            )
        }
    }

    /**
     * Test that turtles attempt crafts in all four corners.
     *
     * @see [#1918](https://github.com/cc-tweaked/CC-Tweaked/issues/1918)
     */
    @GameTest
    fun Craft_offset(helper: GameTestHelper) = helper.sequence {
        for (offset in listOf(0, 1, 4, 5)) {
            thenExecute {
                val turtlePos = BlockPos(2, 2, 2)
                val turtle = helper.getBlockEntity(turtlePos, ModRegistry.BlockEntities.TURTLE_NORMAL.get())

                // Set up turtle inventory
                turtle.clearContent()
                turtle.setItem(offset + 0, ItemStack(Items.COBBLESTONE))
                turtle.setItem(offset + 1, ItemStack(Items.COBBLESTONE))
                turtle.setItem(offset + 2, ItemStack(Items.COBBLESTONE))
                turtle.setItem(offset + 5, ItemStack(Items.STICK))
                turtle.setItem(offset + 9, ItemStack(Items.STICK))

                // Try to craft
                assertTrue(TurtleCraftCommand(1).execute(turtle.access).isSuccess, "Crafting succeeded")

                // And check item was crafted
                helper.assertContainerExactly(
                    turtlePos,
                    listOf(
                        ItemStack(Items.STONE_PICKAXE), ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                        ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                        ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                        ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                    ),
                )
            }
        }
    }

    /**
     * `turtle.equipLeft` equips a tool.
     */
    @GameTest
    fun Equip_tool(helper: GameTestHelper) = helper.sequence {
        thenOnComputer {
            turtle.equipLeft().awaitValue().assertResult(true)
        }
        thenExecute {
            val turtle = helper.getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get())
            assertEquals(
                helper.level.registryAccess().registryOrThrow(ITurtleUpgrade.REGISTRY)
                    .get(ResourceLocation.withDefaultNamespace("diamond_pickaxe")),
                turtle.getUpgrade(TurtleSide.LEFT),
            )
        }
    }

    /**
     * Tests a turtle can break a block that explodes, causing the turtle itself to explode.
     *
     * @see [#585](https://github.com/cc-tweaked/CC-Tweaked/issues/585).
     */
    @GameTest
    fun Breaks_exploding_block(context: GameTestHelper) = context.sequence {
        thenOnComputer { turtle.dig(Optional.empty()) }
        thenWaitUntil { context.assertBlockPresent(Blocks.AIR, BlockPos(2, 2, 2)) }
        thenExecute {
            context.assertItemEntityCountIs(ModRegistry.Items.TURTLE_NORMAL.get(), 1)
            context.assertItemEntityCountIs(Items.BONE_BLOCK, 65)
        }
    }

    /**
     * Asserts items can be inserted into a turtle.
     */
    @GameTest
    fun Can_insert_items(helper: GameTestHelper) = helper.sequence {
        thenWaitUntil {
            helper.assertContainerExactly(BlockPos(2, 2, 2), listOf(ItemStack(ModRegistry.Items.COMPUTER_NORMAL.get())))
        }
    }

    /**
     * Asserts items can be removed from a turtle.
     */
    @GameTest
    fun Can_extract_items(helper: GameTestHelper) = helper.sequence {
        thenWaitUntil { helper.assertContainerEmpty(BlockPos(2, 3, 2)) }
    }

    /**
     * Test that turtles can be crafted with upgrades.
     */
    @GameTest(template = Structures.DEFAULT)
    fun Can_upgrades_be_crafted(helper: GameTestHelper) = helper.immediate {
        fun turtle(left: UpgradeData<ITurtleUpgrade>? = null, right: UpgradeData<ITurtleUpgrade>? = null): ItemStack {
            val stack = ItemStack(ModRegistry.Items.TURTLE_NORMAL.get())
            if (left != null) stack.set(ModRegistry.DataComponents.LEFT_TURTLE_UPGRADE.get(), left)
            if (right != null) stack.set(ModRegistry.DataComponents.RIGHT_TURTLE_UPGRADE.get(), right)
            return stack
        }

        val pick = TurtleUpgrades.instance().get(helper.level.registryAccess(), ItemStack(Items.DIAMOND_PICKAXE))!!
        val sword = TurtleUpgrades.instance().get(helper.level.registryAccess(), ItemStack(Items.DIAMOND_SWORD))!!

        // Check we can craft with upgrades
        assertThat(
            "Craft with item on left equips on right",
            helper.craftItem(
                ItemStack(Items.DIAMOND_PICKAXE), turtle(), ItemStack.EMPTY,
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
            ),
            isStack(turtle(right = pick)),
        )
        assertThat(
            "Craft with item on right equips on left",
            helper.craftItem(
                ItemStack.EMPTY, turtle(), ItemStack(Items.DIAMOND_PICKAXE),
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
            ),
            isStack(turtle(left = pick)),
        )
        assertThat(
            "Craft with two items",
            helper.craftItem(
                ItemStack(Items.DIAMOND_SWORD), turtle(), ItemStack(Items.DIAMOND_PICKAXE),
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
            ),
            isStack(turtle(left = pick, right = sword)),
        )
        assertThat(
            "Maintains upgrades",
            helper.craftItem(
                ItemStack(Items.DIAMOND_SWORD), turtle(left = pick), ItemStack.EMPTY,
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
                ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
            ),
            isStack(turtle(left = pick, right = sword)),
        )

        // Cannot craft when already have item
        helper.assertNotCraftable(
            ItemStack.EMPTY, turtle(left = sword), ItemStack(Items.DIAMOND_PICKAXE),
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
        )

        // Cannot craft with an invalid upgrade
        helper.assertNotCraftable(
            ItemStack.EMPTY, turtle(), ItemStack(Items.DIRT),
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
        )

        // Cannot craft with extra items in the inventory
        helper.assertNotCraftable(
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack(Items.DIRT),
            ItemStack.EMPTY, turtle(), ItemStack(Items.DIAMOND_PICKAXE),
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
        )
        helper.assertNotCraftable(
            ItemStack.EMPTY, turtle(), ItemStack(Items.DIAMOND_PICKAXE),
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack(Items.DIRT),
            ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY,
        )
    }

    /**
     * Render turtles as an item.
     */
    @ClientGameTest
    fun Render_turtle_items(helper: GameTestHelper) = helper.sequence {
        thenExecute { helper.positionAtArmorStand() }
        thenScreenshot()
    }

    /**
     * Render turtles as a block entity.
     */
    @ClientGameTest
    fun Render_turtle_blocks(helper: GameTestHelper) = helper.sequence {
        thenExecute { helper.positionAtArmorStand() }
        thenScreenshot()
    }
}

private val ScriptTaskContext.turtle get() = getApi<TurtleAPI>()

/** Call the main-thread `turtle.setChargeRate` function. */
private suspend fun ScriptTaskContext.setChargeRate(side: ComputerSide, rate: Int) {
    context.executeMainThreadTask { turtle.setChargeRate(side, rate); null }.await()
}

/** Call the main-thread `turtle.setDischargeRate` function. */
private suspend fun ScriptTaskContext.setDischargeRate(side: ComputerSide, rate: Int) {
    context.executeMainThreadTask { turtle.setDischargeRate(side, rate); null }.await()
}

/** Call the main-thread `turtle.transferEnergy` function. */
private suspend fun ScriptTaskContext.transferEnergy(side: ComputerSide, amount: Int): Any? =
    context.executeMainThreadTask { turtle.transferEnergy(side, amount) }.awaitValue()

/** Call the main-thread `turtle.absorbEnergy` function. */
private suspend fun ScriptTaskContext.absorbEnergy(side: ComputerSide, amount: Int): Any? =
    context.executeMainThreadTask { turtle.absorbEnergy(side, amount) }.awaitValue()

/** The turtle under test in the energy tests. */
private fun GameTestHelper.getTestTurtle(): TurtleAccessInternal =
    getBlockEntity(BlockPos(2, 2, 1), ModRegistry.BlockEntities.TURTLE_NORMAL.get()).access as TurtleAccessInternal

/** The (switched off) turtle in front of the [test turtle][getTestTurtle], acting as its neighbouring energy storage. */
private fun GameTestHelper.getNeighbourTurtle(): TurtleAccessInternal =
    getBlockEntity(BlockPos(2, 2, 2), ModRegistry.BlockEntities.TURTLE_NORMAL.get()).access as TurtleAccessInternal

/** Energy (in FE) gained from burning an item, see [dan200.computercraft.shared.turtle.FurnaceRefuelHandler]. */
private val COAL_ENERGY get() = 1600 * Config.turtleFuelToEnergyFactor
private val BLAZE_POWDER_ENERGY get() = 2400 * Config.turtleFuelToEnergyFactor
private val LAVA_BUCKET_ENERGY get() = 20000 * Config.turtleFuelToEnergyFactor

/** Assert a turtle command returned the given [ScriptResult]. */
private fun Any?.assertResult(success: Boolean, reason: String? = null, message: String? = null) =
    assertEquals(ScriptResult(success, reason), this, message)

private suspend fun ScriptTaskContext.getTurtleItemDetail(slot: Int = 1, detailed: Boolean = false): Map<String, *> {
    val item = turtle.getItemDetail(context, Optional.of(slot), Optional.of(detailed)).await()
    assertThat("Returns details", item, array(instanceOf(Map::class.java)))

    @Suppress("UNCHECKED_CAST")
    return item!![0] as Map<String, *>
}
