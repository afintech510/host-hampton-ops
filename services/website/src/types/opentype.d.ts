/**
 * opentype.js 2.0 ships no type declarations. Only what lib/evites/glyphs.ts and
 * fit.ts use is declared. The package's CJS build (jest/node) and its ESM build
 * (webpack, `module` field) both export `parse` by name; the ESM build has NO
 * default export, so import `{ parse }`, never the default.
 */
declare module 'opentype.js' {
  export interface Glyph {
    advanceWidth?: number
  }
  export interface Font {
    numGlyphs: number
    unitsPerEm: number
    /** 0 = .notdef, i.e. the font has no glyph for this character. */
    charToGlyphIndex(char: string): number
    /** fit.ts's fallback measure (no GSUB): one glyph per character, then pair kerning. */
    charToGlyph(char: string): Glyph
    getKerningValue(left: Glyph, right: Glyph): number
    getAdvanceWidth(
      text: string,
      fontSize?: number,
      options?: { kerning?: boolean; features?: Record<string, boolean>; hinting?: boolean; letterSpacing?: number; tracking?: number },
    ): number
  }
  export function parse(buffer: ArrayBuffer, opts?: Record<string, unknown>): Font
}
