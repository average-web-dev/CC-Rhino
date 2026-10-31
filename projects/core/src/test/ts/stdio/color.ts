// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// The color module: immutable RGB colors. Run by StdioLibraryTest.

import * as prelude from './prelude';
import util from 'util';
import { Color } from 'color';

const eq = prelude.eq, throws = prelude.throws;

eq(require('color').Color, Color);
eq((require('node:color') as ColorModule).Color, Color, 'a ROM core module');

const sky = new Color(135, 206, 235);
eq(sky.r, 135);
eq(sky.g, 206);
eq(sky.b, 235);
eq(Object.isFrozen(sky), true, 'immutable');
eq(sky.a, 1, 'opaque unless given');
eq(Object.keys(sky).sort().join(), 'a,b,g,r', 'no name');
eq(String(sky), '#87ceeb');
eq(JSON.stringify({ sky }), '{"sky":"#87ceeb"}');
eq(sky.toNumber(), 0x87ceeb);
eq(util.inspect(sky), 'Color(#87ceeb)');
eq(String(new Color(0, 10, 255)), '#000aff', 'two digits per channel');

// from: '#rrggbb', '#rgb', 0xRRGGBB, { r, g, b }, [r, g, b]; a Color as it is.
eq(Color.from('#87CEEB').equals(sky), true);
eq(String(Color.from('#f80')), '#ff8800');
eq(Color.from(0x87ceeb).equals(sky), true);
eq(Color.from({ r: 135, g: 206, b: 235 }).equals(sky), true);
eq(Color.from([135, 206, 235]).equals(sky), true);
eq(Color.from('#87ceeb80').a, 0x80 / 255);
eq(String(Color.from('#f808')), '#ff880088');
eq(Color.from({ r: 1, g: 2, b: 3, a: 0.25 }).a, 0.25);
eq(Color.from([1, 2, 3, 0.25]).a, 0.25);
eq(Color.from(sky), sky);
eq(Color.equals(sky, Color.from('#87ceeb')), true);
eq(sky.equals(new Color(135, 206, 234)), false);
eq(sky.equals(sky.withAlpha(0.99)), false, 'alpha counts');

// Alpha: toString / JSON show it when not opaque; toNumber never does.
const glass = sky.withAlpha(0.5);
eq(String(glass), '#87ceeb80');
eq(JSON.stringify(glass), '"#87ceeb80"');
eq(glass.toNumber(), 0x87ceeb);
eq(util.inspect(glass), 'Color(#87ceeb80)');
eq(String(sky), '#87ceeb', 'unchanged');

// Adding: in proportion to alpha.
eq(String(new Color(200, 10, 0).add(new Color(100, 20, 5))), '#ff1e05', 'opaque: channels summed, at most 255');
eq(String(new Color(255, 0, 0, 0.5).add(new Color(0, 0, 255, 0.5))), '#800080', 'half red + half blue: opaque purple');
eq(String(new Color(255, 0, 0, 0.5).add(new Color(0, 255, 0, 0))), '#ff000080', 'transparent changes nothing');
eq(String(new Color(255, 0, 0, 0.25).add(new Color(0, 0, 255, 0.25))), '#80008080');
eq(String(new Color(1, 2, 3, 0).add(new Color(4, 5, 6, 0))), '#00000000');

// Brightness: new colors, alpha kept.
eq(String(new Color(100, 0, 200).lighten(0.5)), '#b280e4');
eq(String(new Color(100, 0, 200).darken(0.5)), '#320064');
eq(String(sky.lighten(1)), '#ffffff');
eq(String(sky.darken(1)), '#000000');
eq(sky.darken(0).equals(sky), true);
eq(glass.darken(0.5).a, 0.5);

// Errors like Node's.
throws(() => new Color(256, 0, 0), 'ERR_OUT_OF_RANGE');
throws(() => new Color(1.5, 0, 0), 'ERR_OUT_OF_RANGE');
throws(() => new Color('1' as any, 0, 0), 'ERR_INVALID_ARG_TYPE');
throws(() => Color.from('red'), 'ERR_INVALID_ARG_VALUE');
throws(() => Color.from('#12345'), 'ERR_INVALID_ARG_VALUE');
throws(() => Color.from(0x1000000), 'ERR_OUT_OF_RANGE');
throws(() => Color.from([1, 2] as any), 'ERR_INVALID_ARG_TYPE');
throws(() => new Color(0, 0, 0, 1.5), 'ERR_OUT_OF_RANGE');
throws(() => sky.lighten(1.5), 'ERR_OUT_OF_RANGE');
throws(() => sky.darken(-1), 'ERR_OUT_OF_RANGE');
throws(() => sky.add('#000000' as any), 'ERR_INVALID_ARG_TYPE');
throws(() => Color.from(true as any), 'ERR_INVALID_ARG_TYPE');
throws(() => sky.equals('#87ceeb' as any), 'ERR_INVALID_ARG_TYPE');
