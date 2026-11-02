// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// `image` — pixels, lines, boxes and images on a Term (ROM module /rom/lib/image; CraftOS's paintutils and
// cc.image.nft, #3). Positions are 0-based `{ x, y }` (a `Point` works too); drawing keeps the Term's cursor and colours.

/** A pixel image (.nfp): rows of color indices, `null` for a transparent pixel. */
type PixelImage = (ColorIndex | null)[][];

/** A row of a text image: text with one text and one background blit digit per character. */
interface TextImageRow {
    text: string;
    textColor: string;
    backgroundColor: string;
}

/** A text image (.nft): coloured text, a blit row per line. */
type TextImage = TextImageRow[];

interface ImageModule {
    /** Parse .nfp text: one blit digit (`0` white … `f` black) per pixel; anything else is transparent. */
    parseNfp(text: string): PixelImage;
    /** Read and parse an .nfp file. */
    loadNfp(path: string): PixelImage;
    /** Parse .nft text: `\x1F<digit>` sets the text colour, `\x1E<digit>` the background; each line starts white on black. */
    parseNft(text: string): TextImage;
    /** Read and parse an .nft file. */
    loadNft(path: string): TextImage;
    /** The blit digit of a color index (`ColorIndex.WHITE` → `'0'`, `ColorIndex.BLACK` → `'f'`). */
    blitDigit(color: ColorIndex): string;
    /** Colour one cell. Cells outside the Term are skipped, as by every function here. */
    drawPixel(term: Term, at: CursorPosition, color: ColorIndex): void;
    /** A straight line from `from` to `to` (both included). */
    drawLine(term: Term, from: CursorPosition, to: CursorPosition, color: ColorIndex): void;
    /** The outline of the box with the corners `from` and `to`. */
    drawBox(term: Term, from: CursorPosition, to: CursorPosition, color: ColorIndex): void;
    /** The box with the corners `from` and `to`, filled. */
    drawFilledBox(term: Term, from: CursorPosition, to: CursorPosition, color: ColorIndex): void;
    /** A pixel or text image with its top left corner at `at` (transparent pixels keep what is there). */
    drawImage(term: Term, image: PixelImage | TextImage, at: CursorPosition): void;
}

declare function require(id: "image"): ImageModule;
declare module "image" { const image: ImageModule; export = image; }
