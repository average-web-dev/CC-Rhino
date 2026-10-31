// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/color.ts — an RGBA color (#54): what a palette entry of a TTY shows (Term.getPaletteColor /
// setPaletteColor), for themes, image viewers and games.
//
//   import { Color } from 'color';
//   const sky = Color.from('#87ceeb');
//   sky.r; String(sky);                              // 135, '#87ceeb'
//   sky.darken(0.5); sky.add(new Color(0, 0, 20));   // new colors: half as bright, a bit bluer
//   term.setPaletteColor(ColorIndex.BLUE, sky);      // the TTY now shows sky blue for index 4
//
// A Color is just its channels (r, g, b integers 0–255; alpha `a` 0–1 as in CSS, 1 = opaque unless given): no name,
// immutable (the object is frozen, methods return new colors). Color.from takes '#rrggbb' / '#rrggbbaa' (or '#rgb' / '#rgba'), a 0xRRGGBB
// number, anything with r, g, b (and a), or an [r, g, b(, a)] array.

import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from '/rom/lib/internal/errors';
import { validateInteger, validateNumber } from '/rom/lib/internal/validators';

/** Anything with integer `r`, `g` and `b` channels (0–255), and optionally alpha `a` (0–1, default 1). */
export interface RgbaChannels {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a?: number;
}

/** What Color.from takes: a Color, `'#rrggbb'` / `'#rrggbbaa'`, a `0xRRGGBB` number, `{ r, g, b, a? }` or an array. */
export type ColorLike = Color | string | number | RgbaChannels | readonly [number, number, number, number?];

const inspectCustom: unique symbol = Symbol.for('nodejs.util.inspect.custom') as any;

function hex(channel: number): string {
    return (channel < 16 ? '0' : '') + channel.toString(16);
}

/** `value` if it is a Color, else ERR_INVALID_ARG_TYPE (convert other values with Color.from). */
function colorArg(value: unknown, name: string): Color {
    if (!(value instanceof Color)) throw new ERR_INVALID_ARG_TYPE(name, 'Color', value);
    return value;
}

/** An amount between 0 and 1. */
function validateAmount(amount: unknown): asserts amount is number {
    validateNumber(amount, 'amount', 0, 1);
}

/** An RGBA color: r, g, b 0–255, alpha 0–1. */
export class Color implements RgbaChannels {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    /** Alpha: 0 transparent … 1 opaque. */
    readonly a: number;

    constructor(r: number, g: number, b: number, a = 1) {
        validateInteger(r, 'r', 0, 255);
        validateInteger(g, 'g', 0, 255);
        validateInteger(b, 'b', 0, 255);
        validateNumber(a, 'a', 0, 1);
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
        Object.freeze(this);
    }

    /**
     * A Color from `'#rrggbb'` / `'#rrggbbaa'` / `'#rgb'` / `'#rgba'`, a `0xRRGGBB` number (opaque), `{ r, g, b, a? }` or
     * `[r, g, b, a?]` (a Color as it is).
     */
    static from(value: ColorLike): Color {
        if (value instanceof Color) return value;
        if (typeof value === 'string') {
            let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
            if (match === null) {
                throw new ERR_INVALID_ARG_VALUE('value', value, "must be '#rrggbb', '#rrggbbaa', '#rgb' or '#rgba'");
            }
            let digits = match[1].length <= 4 ? match[1].replace(/./g, '$&$&') : match[1];
            let channel = (i: number) => parseInt(digits.slice(i * 2, i * 2 + 2), 16);
            return new Color(channel(0), channel(1), channel(2), digits.length === 8 ? channel(3) / 255 : 1);
        }
        if (typeof value === 'number') {
            validateInteger(value, 'value', 0, 0xffffff);
            return new Color((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
        }
        if (Array.isArray(value)) {
            if (value.length !== 3 && value.length !== 4) {
                throw new ERR_INVALID_ARG_TYPE('value', ['Color', 'an [r, g, b, a?] array'], value);
            }
            return new Color(value[0], value[1], value[2], value[3] ?? 1);
        }
        if (value !== null && typeof value === 'object') {
            let { r, g, b, a } = value as RgbaChannels;
            return new Color(r, g, b, a ?? 1);
        }
        throw new ERR_INVALID_ARG_TYPE('value', ['Color', 'string', 'number', 'an object with r, g and b'], value);
    }

    /** Whether `a` and `b` have the same channels (alpha included). */
    static equals(a: Color, b: Color): boolean {
        return colorArg(a, 'a').equals(colorArg(b, 'b'));
    }

    /** Whether `other` has the same channels (alpha included). */
    equals(other: Color): boolean {
        let o = colorArg(other, 'other');
        return this.r === o.r && this.g === o.g && this.b === o.b && this.a === o.a;
    }

    /**
     * The colors added (additive mixing, like light), each in proportion to its alpha: the result's alpha is the sum
     * (at most 1), its channels the alpha-weighted sum divided by that (at most 255). Two opaque colors simply add up;
     * adding something fully transparent changes nothing.
     */
    add(other: Color): Color {
        let o = colorArg(other, 'other');
        let alpha = Math.min(this.a + o.a, 1);
        if (alpha === 0) return new Color(0, 0, 0, 0);
        let mix = (x: number, y: number) => Math.min(Math.round((x * this.a + y * o.a) / alpha), 255);
        return new Color(mix(this.r, o.r), mix(this.g, o.g), mix(this.b, o.b), alpha);
    }

    /** Brighter: each of r, g, b moved `amount` (0–1) of the way to 255 (1 is white); alpha stays. */
    lighten(amount: number): Color {
        validateAmount(amount);
        let up = (c: number) => Math.round(c + (255 - c) * amount);
        return new Color(up(this.r), up(this.g), up(this.b), this.a);
    }

    /** Darker: each of r, g, b moved `amount` (0–1) of the way to 0 (1 is black); alpha stays. */
    darken(amount: number): Color {
        validateAmount(amount);
        let down = (c: number) => Math.round(c * (1 - amount));
        return new Color(down(this.r), down(this.g), down(this.b), this.a);
    }

    /** The same color with alpha `a` (0 transparent … 1 opaque). */
    withAlpha(a: number): Color {
        return new Color(this.r, this.g, this.b, a);
    }

    /** `0xRRGGBB` (without alpha). */
    toNumber(): number {
        return (this.r << 16) | (this.g << 8) | this.b;
    }

    /** `'#rrggbb'`, or `'#rrggbbaa'` if not opaque. */
    toString(): string {
        return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${this.a === 1 ? '' : hex(Math.round(this.a * 255))}`;
    }

    /** As toString. */
    toJSON(): string {
        return this.toString();
    }

    /** util.inspect / console.log: `Color(#rrggbb)`. */
    [inspectCustom](): string {
        return `Color(${this.toString()})`;
    }
}

Object.freeze(Color);
