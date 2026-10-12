/**
 * The Minecraft template, from Adam's Canva design "Copy of Minecraft
 * Invitation" (DAG276llccU, 480x672, two pages: page 1 only).
 *
 * The background is page 1 with every text element and the vertical divider in
 * the date block deleted (working copy DAHXvkvov2g, exported 2186x3060, scaled to
 * 1093x1530 and cropped 4 px each side). Kept as art: the illustration (the
 * MINECRAFT logo, Steve, the creeper, the pig and sheep, the cake and its five
 * candle images), the dark pixel panel, and the two white dotted rules that
 * frame the date block (1200 and 1415 here).
 *
 * Canva's geometry x 2.277 (element centres):
 *
 *   join us to celebrate!   108.6 / h 30   -> 281    25.6 -> 58
 *   5 (on the cake)         280.9 / h 167  -> 829   140.1 -> 319
 *   SVEN                    433.7 / h 64   -> 1060   53.5 -> 122
 *   is turning five!        488.3 / h 34   -> 1150   29.2 -> 67
 *   NOV (rotated -90)       centre 84.8,576.6 -> 189,1313   34.7 -> 79
 *   11                      centre 149.9,583.3 -> 337,1328  71.6 -> 163
 *   10AM-12PM / HOST HAMPTON / 295 MONTAUK HIGHWAY / SPEONK   left 229 -> 518, 17.0 -> 39
 *   RSVP to <mom> <phone>   636.5 / h 21   -> 1468   18.5 -> 42
 *
 * Silkscreen is much wider than Canva's pixel face (it sets "IS TURNING SEVEN!"
 * 22% wider at the same size), so every size is ~80% of Canva's and the name,
 * the age and the date pieces shrink to fit.
 *
 * What changed, and why:
 *   - The month is NOT set sideways. Canva's "NOV" is an abbreviation and the
 *     facts only carry the full month ("NOVEMBER", 8 wide pixel letters), which
 *     rotated into the 215 px between the dotted rules would be ~29 px tall
 *     beside a 150 px day. So the block is month-over-day on the left and
 *     weekday-over-time on the right, centred in the panel. (A short-month fact
 *     would allow the sideways "NOV" again.)
 *   - Canva's place lines (HOST HAMPTON / 295 MONTAUK HIGHWAY / SPEONK) were in
 *     the right column. `placeLine` is ONE string ("Host Hampton · 295 Montauk
 *     Hwy, Speonk", or a family's whole street address), which in a 400 px column
 *     would shrink to unreadable, so it runs full width under the lower rule,
 *     with the host line beneath it where Canva's RSVP was.
 *   - "is turning five!" is a row: "IS TURNING" + `ageWords` + "!" with no gap,
 *     the space being a no-break space inside the first piece. No age reads
 *     "IS HAVING A PARTY!". The big "5" on the cake is `ageNumber` and simply
 *     disappears with no age, leaving the cake.
 *   - "RSVP to Mariana <phone>" is `hostContactLine` (guests RSVP online; the line
 *     names Allie).
 *
 * Known mismatch: the cake has FIVE candle images (separate art elements in
 * Canva, kept). They do not change with the age.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const GREEN = '#10d000'
const LIME = '#aed927'
const INK = '#050a05'

const PIXEL_SHADOW = { x: 4, y: 4, color: INK }

export const MINECRAFT_TEMPLATE: TemplateLayout = {
  slug: 'minecraft',
  label: 'Minecraft',
  source: { canvaDesignId: 'DAG276llccU', canvaArtCopyId: 'DAHXvkvov2g' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/minecraft/background.webp', raster: '/evites/minecraft/background.jpg' },
  backgroundColor: '#306821',
  layers: [],
  slots: [
    {
      id: 'invited_line',
      type: 'text',
      staticText: 'JOIN US TO CELEBRATE!',
      top: 249,
      font: 'silkscreen700',
      size: 50,
      lineHeight: 1.2,
      color: GREEN,
      shadow: PIXEL_SHADOW,
      glow: { stops: [{ color: INK, radius: 3 }, { color: INK, radius: 10 }] },
    },
    {
      id: 'age_big',
      type: 'text',
      bind: 'ageNumber',
      top: 658,
      font: 'silkscreen700',
      size: 300,
      minSize: 160,
      maxWidth: 620,
      lineHeight: 1,
      color: LIME,
      stroke: { width: 10, color: INK },
      shadow: { x: 12, y: 12, color: INK },
      showWhen: 'ageNumber',
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeDisplay',
      uppercase: true,
      top: 988,
      font: 'silkscreen700',
      size: 112,
      minSize: 44,
      maxWidth: 700,
      lineHeight: 1.2,
      color: GREEN,
      glow: { stops: [{ color: GREEN, radius: 6 }, { color: '#0a7a00', radius: 18 }] },
    },
    {
      id: 'turning_row',
      type: 'row',
      top: 1119,
      gap: 0,
      maxWidth: 800,
      align: 'baseline',
      boxHeight: 62,
      showWhen: 'ageWords',
      children: [
        { id: 'turning_word', type: 'text', staticText: 'IS TURNING ', top: 0, font: 'silkscreen700', size: 52, minSize: 28, lineHeight: 1.2, color: LIME },
        { id: 'turning_age', type: 'text', bind: 'ageWords', uppercase: true, top: 0, font: 'silkscreen700', size: 52, minSize: 28, lineHeight: 1.2, color: LIME },
        { id: 'turning_bang', type: 'text', staticText: '!', top: 0, font: 'silkscreen700', size: 52, minSize: 28, lineHeight: 1.2, color: LIME },
      ],
    },
    {
      id: 'party_no_age',
      type: 'text',
      staticText: 'IS HAVING A PARTY!',
      top: 1119,
      font: 'silkscreen700',
      size: 52,
      lineHeight: 1.2,
      color: LIME,
      showWhen: '!ageWords',
    },
    // ---- the date block, between the dotted rules (1200..1415)
    {
      id: 'date_month',
      type: 'text',
      bind: 'monthText',
      uppercase: true,
      top: 1209,
      box: { left: 170, width: 380, align: 'center' },
      font: 'silkscreen700',
      size: 46,
      minSize: 26,
      maxWidth: 370,
      lineHeight: 1.2,
      color: LIME,
      showWhen: 'dayText',
    },
    {
      id: 'date_day',
      type: 'text',
      bind: 'dayText',
      top: 1239,
      box: { left: 170, width: 380, align: 'center' },
      font: 'silkscreen700',
      size: 150,
      minSize: 90,
      maxWidth: 370,
      lineHeight: 1,
      color: GREEN,
      glow: { stops: [{ color: GREEN, radius: 6 }, { color: '#0a7a00', radius: 18 }] },
      showWhen: 'dayText',
    },
    {
      id: 'date_weekday',
      type: 'text',
      bind: 'weekdayText',
      uppercase: true,
      top: 1252,
      box: { left: 580, width: 420, align: 'left' },
      font: 'silkscreen700',
      size: 40,
      minSize: 24,
      maxWidth: 400,
      lineHeight: 1.2,
      color: '#ffffff',
      showWhen: 'dayText',
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'timeText',
      uppercase: true,
      top: 1310,
      box: { left: 580, width: 420, align: 'left' },
      font: 'silkscreen700',
      size: 40,
      minSize: 24,
      maxWidth: 400,
      lineHeight: 1.2,
      color: '#ffffff',
      showWhen: 'timeText',
    },
    {
      // A preview has no date pieces: "PICK YOUR DATE" across the block instead.
      id: 'date_line',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 1274,
      font: 'silkscreen700',
      size: 52,
      minSize: 24,
      maxWidth: 860,
      lineHeight: 1.2,
      color: LIME,
      showWhen: '!dayText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      uppercase: true,
      top: 1430,
      font: 'silkscreen700',
      size: 28,
      minSize: 16,
      maxWidth: 920,
      lineHeight: 1.2,
      color: '#ffffff',
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      uppercase: true,
      top: 1473,
      font: 'silkscreen700',
      size: 26,
      minSize: 16,
      maxWidth: 820,
      lineHeight: 1.2,
      color: LIME,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'silkscreen700',
    titleSize: 74,
    titleColor: GREEN,
    glow: { stops: [{ color: GREEN, radius: 6 }, { color: '#0a7a00', radius: 18 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: LIME,
    ctaColor: '#0d1420',
    hostColor: LIME,
    // The art's centre crop is the cake and the characters, far too busy under text: the panel's colours instead.
    backdrop: 'linear-gradient(135deg, #0d1420 0%, #142236 55%, #1f4d1a 100%)',
    portraitShadow: '0 10px 34px #10d00044',
  },
}
