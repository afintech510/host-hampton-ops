/**
 * The Stitch template, from Adam's Canva design "Copy of v8 Stitch invitation"
 * (DAHDB-er7jQ, 480x672): a watercolour Stitch and pink/blue flowers on white.
 *
 * The background is that design with every text element and the two thin divider
 * lines of the date ("Sunday | 4 | October") deleted (working copy DAHXvnrUzWo,
 * exported 2186x3060, scaled to 1093x1530 and cropped 4 px each side). So a Canva
 * top x 2.277 is our top, a Canva left x 2.277 - 4 is our left, and a font size
 * x 2.277 is ours:
 *
 *   PLEASE JOIN US TO / CELEBRATE   36.4 -> 83 (two lines)   22.7 -> 52   centre x 667
 *   Scarlett's                     102.0 -> 232             88.6 -> 202   centre x 648
 *   7TH BIRTHDAY                   197.8 -> 450             30.6 -> 70    centre x 689
 *   Sunday | 4 | October           464.8 -> 1058            26.1 -> 59    centre x ~680
 *   4:00 - 6:00 PM                 504.9 -> 1150            18.4 -> 42
 *   105A Ponquogue Ave / Hampton.. 535.6 -> 1220            14.9 -> 34    (two lines; ours is one)
 *   RSVP to Maggie / 516-...       584.4 -> 1331            17.0 -> 39    (two lines; ours is one)
 *
 * ...then tuned by eye. The top block sits in a box centred at x 680 (the flowers
 * fill the top-left corner); the lower block in a box centred at x 735, a little
 * right of Canva's, because ours are single lines that can be long (a street
 * address, the host line) and Stitch's shoulder and foot fill x < ~450 there.
 *
 * Canva's script (a flourished wedding script) and its serifs are not ours: Great
 * Vibes is the nearest open elegant script, Playfair Display the serif.
 *
 * Wording: the design's "RSVP to Maggie 516-..." becomes the host contact line
 * (guests RSVP on the invite page). "7TH BIRTHDAY" is the bound ordinal plus a
 * static "BIRTHDAY", which reads on its own with no age. The date row is the
 * pieces with showWhen 'dayText'; a preview (no date) shows `dateLine` ("Pick your
 * date") in its place, so no orphan bars.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const INK = '#141312'
const NAME_INK = '#343434'
const BAR = '#6b6866'

/** The heading block, clear of the flowers in the top-left corner. */
const TOP_BOX = { left: 300, width: 760, align: 'center' as const }
/** The details block, right of Stitch's shoulder and foot. */
const LOW_BOX = { left: 410, width: 620, align: 'center' as const }
/** The place line may run further left: by its height Stitch's leg has fallen away to x ~330. */
const PLACE_BOX = { left: 345, width: 720, align: 'center' as const }

export const STITCH_TEMPLATE: TemplateLayout = {
  slug: 'stitch',
  label: 'Stitch',
  source: { canvaDesignId: 'DAHDB-er7jQ', canvaArtCopyId: 'DAHXvnrUzWo' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/stitch/background.webp', raster: '/evites/stitch/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'join_line_1',
      type: 'text',
      staticText: 'PLEASE JOIN US TO',
      top: 80,
      box: TOP_BOX,
      font: 'playfair700',
      size: 50,
      lineHeight: 1.2,
      letterSpacingEm: 0.06,
      color: INK,
    },
    {
      id: 'join_line_2',
      type: 'text',
      staticText: 'CELEBRATE',
      top: 141,
      box: TOP_BOX,
      font: 'playfair700',
      size: 50,
      lineHeight: 1.2,
      letterSpacingEm: 0.06,
      color: INK,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      top: 192,
      box: TOP_BOX,
      font: 'greatvibes',
      size: 205,
      minSize: 90,
      maxWidth: 730,
      lineHeight: 1.3,
      color: NAME_INK,
    },
    {
      id: 'age_row',
      type: 'row',
      top: 430,
      box: TOP_BOX,
      gap: 18,
      maxWidth: 730,
      align: 'baseline',
      boxHeight: 98,
      children: [
        {
          id: 'age',
          type: 'text',
          bind: 'ageOrdinal',
          uppercase: true,
          top: 0,
          font: 'playfair400',
          size: 70,
          lineHeight: 1.4,
          color: INK,
          showWhen: 'ageOrdinal',
        },
        {
          id: 'birthday_word',
          type: 'text',
          staticText: 'BIRTHDAY',
          top: 0,
          font: 'playfair400',
          size: 70,
          lineHeight: 1.4,
          color: INK,
        },
      ],
    },
    {
      id: 'date_row',
      type: 'row',
      top: 1046,
      box: LOW_BOX,
      gap: 16,
      maxWidth: 590,
      align: 'baseline',
      boxHeight: 83,
      showWhen: 'dayText',
      children: [
        { id: 'weekday', type: 'text', bind: 'weekdayText', top: 0, font: 'playfair400', size: 59, lineHeight: 1.4, color: INK },
        { id: 'bar_1', type: 'text', staticText: '|', top: 0, font: 'playfair400', size: 59, lineHeight: 1.4, color: BAR },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'playfair400', size: 59, lineHeight: 1.4, color: INK },
        { id: 'bar_2', type: 'text', staticText: '|', top: 0, font: 'playfair400', size: 59, lineHeight: 1.4, color: BAR },
        { id: 'month', type: 'text', bind: 'monthText', top: 0, font: 'playfair400', size: 59, lineHeight: 1.4, color: INK },
      ],
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      showWhen: '!dayText',
      top: 1052,
      box: LOW_BOX,
      font: 'playfair400',
      size: 52,
      minSize: 30,
      maxWidth: 600,
      lineHeight: 1.4,
      color: INK,
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      showWhen: 'timeText',
      top: 1140,
      box: LOW_BOX,
      font: 'playfair400',
      size: 42,
      minSize: 28,
      maxWidth: 600,
      lineHeight: 1.4,
      color: INK,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1212,
      box: PLACE_BOX,
      font: 'playfair400',
      size: 34,
      minSize: 22,
      maxWidth: 700,
      lineHeight: 1.45,
      color: INK,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      showWhen: 'hostContactLine',
      top: 1300,
      box: LOW_BOX,
      font: 'playfair400',
      size: 33,
      minSize: 22,
      maxWidth: 600,
      lineHeight: 1.45,
      color: INK,
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'greatvibes',
    titleSize: 74,
    titleColor: '#2f5f9e',
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#e3efff', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: '#4f86c6',
    ctaColor: '#ffffff',
    titleUppercase: false,
    textColor: '#2a2f3a',
    hostColor: '#4f6f9e',
    backdrop: 'linear-gradient(135deg, #e3efff 0%, #ffffff 55%, #fde6ef 100%)',
    portraitShadow: '0 10px 30px #3a5a8a44',
  },
}
