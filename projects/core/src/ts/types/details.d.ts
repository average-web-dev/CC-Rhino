// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// Shapes of the item / block / fluid / entity "detail" tables returned by inventory, turtle, command and fluid
// methods. They are built by detail providers (common/.../shared/details) rather than records, because other mods
// may register providers that add their own fields — hence the index signature on the detailed forms.
// The generated API declarations (common/build/tsTypes) refer to these by name.

/** A tag set: every tag id the object has, mapped to `true`. */
type TagSet = Record<string, boolean>;

/** Basic item information, as returned by inventory `list()` and `turtle.getItemDetail()` without `detailed`. */
interface ItemBasicDetail {
    /** The item id, e.g. `"minecraft:dirt"`. */
    name: string;
    count: number;
    /** A hash of the item's non-default components, so otherwise-identical stacks can be told apart. */
    nbt?: string;
}

/** Full item information (`getItemDetail`, `turtle.getItemDetail(slot, true)`, `turtle.getEquippedLeft()`, …). */
interface ItemDetail extends ItemBasicDetail {
    displayName: string;
    maxCount: number;
    damage?: number;
    maxDamage?: number;
    /** Remaining durability between 0 and 1, when the item shows a durability bar. */
    durability?: number;
    tags: TagSet;
    itemGroups: { id?: string; displayName: string }[];
    lore?: string[];
    enchantments?: { name: string; level: number; displayName: string }[];
    potionEffects?: { name: string; displayName: string; potency?: number; duration: number }[];
    unbreakable?: boolean;
    mapColor?: number;
    mapColour?: number;
    /** Fields added by other mods' detail providers. */
    [field: string]: unknown;
}

/** Information about a block in the world (`turtle.inspect()`, `commands.getBlockInfo()`). */
interface BlockDetail {
    /** The block id, e.g. `"minecraft:oak_log"`. */
    name: string;
    /** The block state's properties, e.g. `{ axis: "x" }`. */
    state: Record<string, string | number | boolean>;
    tags: TagSet;
    mapColor?: number;
    mapColour?: number;
    /** Fields added by other mods' detail providers. */
    [field: string]: unknown;
}

/** {@link BlockDetail} plus the block entity's data, as returned by `commands.getBlockInfo()`. */
interface BlockInfo extends BlockDetail {
    /** The block entity's NBT, if the block has one. */
    nbt?: Record<string, unknown>;
}

/** Basic fluid information, as returned by fluid storage `tanks()`. */
interface FluidBasicDetail {
    /** The fluid id, e.g. `"minecraft:water"`. */
    name: string;
    /** The amount of fluid, in millibuckets (Forge) or droplets (Fabric). */
    amount: number;
}

/** Information about an entity (`commands.getEntities()`). */
interface EntityDetail {
    /** The entity type id, e.g. `"minecraft:pig"`. */
    name: string;
    displayName: string;
    tags: TagSet;
    health?: number;
    maxHealth?: number;
    /** Fields added by other mods' detail providers. */
    [field: string]: unknown;
}
