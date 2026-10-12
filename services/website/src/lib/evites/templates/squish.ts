/**
 * The Squish on Over template, from Adam's Canva design "Squishie Birthday Invite"
 * (DAGXHtYLjMc, 480x672): a pastel tie-dye with sparkles and plush characters all
 * round the border.
 *
 * The background is that design with every text element and the four date divider
 * lines deleted (working copy DAHXvqrGOW0, exported 2186x3060, scaled to 1093x1530
 * and cropped 4 px each side to the 1085x1530 canvas). Canva top x 2.277 = canvas
 * top, Canva left x 2.277 - 4 = canvas left, font size x 2.277 = canvas size:
 *
 *   Squish on over   147.3 -> 335   53.4 -> 122
 *   For              214.7 -> 489   22.7 -> 52
 *   Layla Rae's      241.2 -> 549   76.7 -> 175
 *   Spa              316.8 -> 721   39.0 -> 89
 *   Birthday         363.0 -> 826   39.0 -> 89
 *   June | 14 | 12-2 pm   437.9 / 416.3 -> 997 / 948   17.0 / 51.2 -> 39 / 117
 *                         centres x 345 | 550 | 771
 *   Host Hampton /   486.4 -> 1107  16.0 -> 36    (two lines in Canva)
 *     295 Montauk...
 *   Rsvp to Jen at   538-548 -> 1225-1248
 *
 * ...then tuned by eye. Fredoka is wider than Canva's rounded face, so the slogan is
 * 100 and the theme lines 84. The place and host lines are one line each and narrower
 * than the canvas, because the plush characters close in at the bottom (koala on the
 * left from y ~1200, the cream unicorn on the right from y ~1150).
 *
 * Fonts: Canva's rounded display face -> Fredoka; its looping script -> Dancing Script
 * 700 (Great Vibes is the thinner match, but a hairline lilac script does not read on
 * tie-dye). The date row is clustered (month right-aligned, time left-aligned against
 * the day) because "NOVEMBER" is much wider than Canva's "JUNE".
 * Teal, lilac and pink on a pastel tie-dye are faint, so the lettering carries a
 * soft white halo.
 *
 * Wording:
 *   - "Squish on over" and "for" are decorative: static.
 *   - "Layla Rae's" -> `honoreePossessive` ("Mia's" / "our Birthday Star's").
 *   - "SPA / BIRTHDAY" said what the party is, and binding "SPA" alone would print
 *     "BIRTHDAY BIRTHDAY" for an unthemed party. So it is `themeWord` over a static
 *     "PARTY": "SLIME / PARTY", and "BIRTHDAY / PARTY" when unthemed.
 *   - "JUNE | 14 | 12-2 PM" -> `monthText` | `dayText` | `timeText`, each hiding when
 *     empty; a preview shows `dateLine` ("Pick your date") instead. Canva's divider
 *     lines above and below the month and time were deleted with the text: they are
 *     per-date decoration and would frame nothing in a preview.
 *   - "Host Hampton / 295 Montauk Highway Speonk" -> `placeLine`.
 *   - "Rsvp to Jen at (631) 494-6389" -> `hostContactLine` (guests RSVP online, and
 *     the message is from Allie); the pink script "Rsvp" is dropped with it.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { Glow, TemplateLayout } from '@/lib/evites/templates/types'

const TEAL = '#5eb0b3'
const GREEN = '#86b552'
const LILAC = '#a877c2'
const PINK = '#f7819b'
const PURPLE = '#6f5389'

/** A soft white halo so pastel lettering reads on the tie-dye. */
const HALO: Glow = { stops: [{ color: '#ffffff', radius: 4 }, { color: '#ffffff', radius: 12 }] }
const HALO_SMALL: Glow = { stops: [{ color: '#ffffff', radius: 3 }, { color: '#ffffff', radius: 8 }] }

export const SQUISH_TEMPLATE: TemplateLayout = {
  slug: 'squish',
  label: 'Squish on Over',
  source: { canvaDesignId: 'DAGXHtYLjMc', canvaArtCopyId: 'DAHXvqrGOW0' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/squish/background.webp', raster: '/evites/squish/background.jpg' },
  backgroundColor: '#f6e6f0',
  layers: [],
  slots: [
    {
      id: 'slogan',
      type: 'text',
      staticText: 'SQUISH ON OVER',
      top: 358,
      font: 'fredoka700',
      size: 90,
      lineHeight: 1.2,
      letterSpacingEm: 0.04,
      color: TEAL,
      glow: HALO,
    },
    {
      id: 'for_word',
      type: 'text',
      staticText: 'for',
      top: 470,
      font: 'fredoka600',
      size: 52,
      lineHeight: 1.2,
      letterSpacingEm: 0.1,
      color: GREEN,
      glow: HALO_SMALL,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      top: 535,
      font: 'dancing700',
      size: 160,
      minSize: 64,
      maxWidth: 740,
      lineHeight: 1.25,
      color: LILAC,
      glow: HALO,
    },
    {
      id: 'theme_word',
      type: 'text',
      bind: 'themeWord',
      top: 742,
      font: 'fredoka700',
      size: 84,
      minSize: 48,
      maxWidth: 700,
      lineHeight: 1.2,
      letterSpacingEm: 0.12,
      uppercase: true,
      color: TEAL,
      glow: HALO,
    },
    {
      id: 'party_word',
      type: 'text',
      staticText: 'PARTY',
      top: 838,
      font: 'fredoka700',
      size: 84,
      lineHeight: 1.2,
      letterSpacingEm: 0.12,
      color: TEAL,
      glow: HALO,
    },
    {
      id: 'date_month',
      type: 'text',
      bind: 'monthText',
      top: 996,
      box: { left: 140, width: 322, align: 'right' },
      font: 'fredoka600',
      size: 40,
      minSize: 26,
      maxWidth: 300,
      lineHeight: 1.3,
      letterSpacingEm: 0.15,
      uppercase: true,
      color: PURPLE,
      glow: HALO_SMALL,
      showWhen: 'monthText',
    },
    {
      id: 'date_day',
      type: 'text',
      bind: 'dayText',
      top: 958,
      box: { left: 470, width: 150, align: 'center' },
      font: 'fredoka700',
      size: 112,
      lineHeight: 1.1,
      color: PINK,
      glow: HALO,
      showWhen: 'dayText',
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'timeText',
      top: 996,
      box: { left: 632, width: 322, align: 'left' },
      font: 'fredoka600',
      size: 40,
      minSize: 26,
      maxWidth: 300,
      lineHeight: 1.3,
      letterSpacingEm: 0.08,
      uppercase: true,
      color: PURPLE,
      glow: HALO_SMALL,
      showWhen: 'timeText',
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      top: 984,
      font: 'fredoka700',
      size: 56,
      minSize: 30,
      maxWidth: 680,
      lineHeight: 1.2,
      letterSpacingEm: 0.08,
      uppercase: true,
      color: PINK,
      glow: HALO,
      showWhen: '!dayText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1104,
      font: 'fredoka600',
      size: 34,
      minSize: 18,
      maxWidth: 660,
      lineHeight: 1.3,
      letterSpacingEm: 0.04,
      color: PURPLE,
      glow: HALO_SMALL,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1160,
      font: 'fredoka600',
      size: 30,
      minSize: 17,
      maxWidth: 560,
      lineHeight: 1.3,
      color: PURPLE,
      glow: HALO_SMALL,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'dancing700',
    titleSize: 74,
    titleColor: LILAC,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#f3e6ff', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: TEAL,
    ctaColor: '#ffffff',
    titleUppercase: false,
    textColor: '#4a3560',
    hostColor: PURPLE,
    backdrop: 'linear-gradient(135deg, #fde7f1 0%, #fff8d9 35%, #dcf3f1 70%, #ece1fb 100%)',
    portraitShadow: '0 10px 30px #6f538955',
  },
}
