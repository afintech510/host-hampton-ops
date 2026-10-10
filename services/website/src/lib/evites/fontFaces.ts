/**
 * `@font-face` rules for the web `InviteCanvas` (spec §5 "Fonts").
 *
 * The page draws the invitation in the SAME five bundled `.woff` files Satori
 * renders the image with, under the family names `FONT_STYLE` (the canvas) uses.
 * Built from `FONT_FILES` (glyphs.ts), the table Satori's font loader also reads,
 * so the page and the picture can never name a different file (rule 11).
 *
 * Self-hosted from `/evites/fonts/` (committed under `public/`, with their OFL
 * licences): the page requests no Google Fonts and no third party. WOFF, not
 * WOFF2: the same bytes opentype.js measured the layout with.
 *
 * `font-display: swap`: a slow phone shows the text in a fallback face for a
 * moment rather than a blank card. Every text slot sits in a fixed-width box, so
 * the swap changes letter shapes, not the layout.
 */

import { FONT_FILES, FONT_KEYS } from '@/lib/evites/glyphs'

export const FONT_URL_PREFIX = '/evites/fonts/'

export function fontFaceCss(): string {
  return FONT_KEYS.map((key) => {
    const f = FONT_FILES[key]
    return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url('${FONT_URL_PREFIX}${f.file}') format('woff')}`
  }).join('\n')
}
