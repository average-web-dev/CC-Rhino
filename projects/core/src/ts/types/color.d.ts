// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `color` — an RGBA color (ROM module /rom/lib/color): what a palette entry of a TTY shows (Term.getPaletteColor /
// setPaletteColor). Immutable, no name: just its channels (r, g, b 0–255; alpha 0–1 as in CSS, 1 unless given);
// methods return new colors.

/** Anything with integer `r`, `g` and `b` channels (0–255), and optionally alpha `a` (0–1, default 1). */
interface RgbaChannels {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a?: number;
}

/** What Color.from takes: a Color, `'#rrggbb'` / `'#rrggbbaa'`, a `0xRRGGBB` number, `{ r, g, b, a? }` or an array. */
type ColorLike = Color | string | number | RgbaChannels | readonly [number, number, number, number?];

/** An RGBA color: r, g, b 0–255, alpha 0–1. */
interface Color extends RgbaChannels {
    /** Alpha: 0 transparent … 1 opaque. */
    readonly a: number;
    /** Whether `other` has the same channels (alpha included). */
    equals(other: Color): boolean;
    /**
     * The colors added (additive mixing, like light), each in proportion to its alpha: the result's alpha is the sum
     * (at most 1), its channels the alpha-weighted sum divided by that (at most 255). Two opaque colors simply add up;
     * adding something fully transparent changes nothing.
     */
    add(other: Color): Color;
    /** Brighter: each of r, g, b moved `amount` (0–1) of the way to 255 (1 is white); alpha stays. */
    lighten(amount: number): Color;
    /** Darker: each of r, g, b moved `amount` (0–1) of the way to 0 (1 is black); alpha stays. */
    darken(amount: number): Color;
    /** The same color with alpha `a` (0 transparent … 1 opaque). */
    withAlpha(a: number): Color;
    /** `0xRRGGBB` (without alpha). */
    toNumber(): number;
    /** `'#rrggbb'`, or `'#rrggbbaa'` if not opaque. */
    toString(): string;
    /** As toString. */
    toJSON(): string;
}

interface ColorConstructor {
    new (r: number, g: number, b: number, a?: number): Color;
    readonly prototype: Color;
    /**
     * A Color from `'#rrggbb'` / `'#rrggbbaa'` / `'#rgb'` / `'#rgba'`, a `0xRRGGBB` number (opaque), `{ r, g, b, a? }` or
     * `[r, g, b, a?]` (a Color as it is).
     */
    from(value: ColorLike): Color;
    /** Whether `a` and `b` have the same channels (alpha included). */
    equals(a: Color, b: Color): boolean;
}

/** The 16 Minecraft dyes by id: the channels of a bundled cable (redstone.setBundledOutput), wool colors, …. */
interface DyeMap {
    readonly WHITE: 0; readonly ORANGE: 1; readonly MAGENTA: 2; readonly LIGHT_BLUE: 3; readonly YELLOW: 4;
    readonly LIME: 5; readonly PINK: 6; readonly GRAY: 7; readonly GREY: 7; readonly LIGHT_GRAY: 8;
    readonly LIGHT_GREY: 8; readonly CYAN: 9; readonly PURPLE: 10; readonly BLUE: 11; readonly BROWN: 12;
    readonly GREEN: 13; readonly RED: 14; readonly BLACK: 15;
}

/** A dye id, 0–15 (one of the Dye values), like a numeric enum. */
type Dye = DyeMap[keyof DyeMap];

interface ColorModule {
    Color: ColorConstructor;
    Dye: DyeMap;
}

declare function require(id: "color"): ColorModule;
declare module "color" { const color: ColorModule; export = color; }
