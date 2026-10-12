/**
 * The Barbie Disco template, from Adam's Canva design "Barbie Disco Invitation"
 * (DAGclYNm5BA, 480x672, page 1 of 2).
 *
 * The background is page 1 with every text element and the "Host HAMPTON" wordmark
 * image deleted (working copy DAHXvpCREHs, exported 2186x3060, scaled to 1093x1530
 * and cropped 4 px each side). The wordmark names the venue, which is wrong for an
 * at-home party, so the venue now comes from `placeLine` like every other place.
 * The badge's double ring is IMAGE art and stays; "COME ON" / "LET'S GO PARTY" were
 * curved TEXT on it (a rotated text element each, set on an arc in Canva). The
 * renderer has no curved text, so they are set straight inside the inner ring,
 * above and below the name. So every `top` below starts from the Canva element's
 * own top x 2.277, and every size from its font size x 2.277:
 *
 *   COME ON           69.7 -> 159     15.6 -> 36   (straight now: moved inside the ring, 224)
 *   Aaliyah           98.0 -> 223     68.7 -> 156  (rotated -8.9 deg in Canva; level here)
 *   LET'S GO PARTY   173.6 -> 395     15.6 -> 36   (straight now: 420)
 *   4th Birthday     241.7 -> 550     51.1 -> 116
 *   Celebration      294.9 -> 671     53.7 -> 122
 *   (wordmark)       345.9 -> 788                  -> placeLine, 840
 *   295 Montauk Hwy  425.4 -> 969     12.0 -> 27   (merged into placeLine above)
 *   SUNDAY           464.8 -> 1058    18.4 -> 42
 *   March 1st        490.6 -> 1117    18.4 -> 42
 *   12:00 ~ 2:00pm   512.0 -> 1166    18.4 -> 42
 *   RSVP to Kaitlyn  555.0 -> 1264    18.9 -> 43   -> hostContactLine
 *
 * ...then tuned by eye. The ring is centred at x 549, not 542 (the canvas centre),
 * so the badge slots carry a box centred there. The date block moved up to fill the
 * wordmark's space and keep clear of the compact (right) and the bottom-left disco ball.
 *
 * Fonts: Canva's bubbly script for the name -> Lobster; its thin script for
 * "4th Birthday Celebration" and the RSVP line -> Dancing Script 700; its typewriter
 * serif for the date -> Playfair Display 400; the badge caps -> Poppins 600.
 *
 * Wording: "4th Birthday" is a row [ageOrdinal, "Birthday"], so with no age it reads
 * "Birthday Celebration". The name is `honoreeName` ("Birthday Star" with no name).
 * "March 1st" becomes `monthText dayText` ("November 14": the facts carry no ordinal day).
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const PINK = '#f8539f'
const HOT_PINK = '#e8157a'
const INK = '#2a1424'

/** The badge ring's own centre line: x 549 (a 900-wide box from 99). */
const RING_BOX = { left: 99, width: 900, align: 'center' as const }

export const BARBIE_DISCO_TEMPLATE: TemplateLayout = {
  slug: 'barbie-disco',
  label: 'Barbie Disco',
  source: { canvaDesignId: 'DAGclYNm5BA', canvaArtCopyId: 'DAHXvpCREHs' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/barbie-disco/background.webp', raster: '/evites/barbie-disco/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'come_on',
      type: 'text',
      staticText: 'COME ON',
      top: 238,
      box: RING_BOX,
      font: 'poppins600',
      size: 24,
      lineHeight: 1.3,
      letterSpacingEm: 0.18,
      color: PINK,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeName',
      top: 268,
      box: RING_BOX,
      font: 'lobster',
      size: 112,
      minSize: 48,
      // Clear of the right-hand disco ball (x 818): the ring box is centred on 549.
      maxWidth: 480,
      lineHeight: 1.25,
      color: PINK,
      stroke: { width: 5, color: '#ffffff' },
      shadow: { x: 4, y: 4, color: '#ffd0e6' },
    },
    {
      id: 'lets_go_party',
      type: 'text',
      staticText: "LET'S GO PARTY",
      top: 402,
      box: RING_BOX,
      font: 'poppins600',
      size: 20,
      lineHeight: 1.3,
      letterSpacingEm: 0.08,
      color: PINK,
    },
    {
      id: 'birthday_row',
      type: 'row',
      top: 548,
      gap: 26,
      maxWidth: 720,
      align: 'baseline',
      boxHeight: 150,
      children: [
        { id: 'age', type: 'text', bind: 'ageOrdinal', top: 0, font: 'dancing700', size: 116, lineHeight: 1.3, color: PINK, showWhen: 'ageOrdinal' },
        { id: 'birthday_word', type: 'text', staticText: 'Birthday', top: 0, font: 'dancing700', size: 116, lineHeight: 1.3, color: PINK },
      ],
    },
    {
      id: 'celebration_word',
      type: 'text',
      staticText: 'Celebration',
      top: 672,
      font: 'dancing700',
      size: 120,
      lineHeight: 1.3,
      color: PINK,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 850,
      font: 'poppins400',
      size: 28,
      minSize: 16,
      maxWidth: 520,
      lineHeight: 1.5,
      color: INK,
    },
    {
      id: 'weekday',
      type: 'text',
      bind: 'weekdayText',
      uppercase: true,
      top: 930,
      font: 'playfair400',
      size: 44,
      lineHeight: 1.35,
      letterSpacingEm: 0.08,
      color: INK,
      showWhen: 'dayText',
    },
    {
      id: 'month_day_row',
      type: 'row',
      top: 992,
      gap: 14,
      maxWidth: 360,
      align: 'baseline',
      boxHeight: 60,
      showWhen: 'dayText',
      children: [
        { id: 'month', type: 'text', bind: 'monthText', top: 0, font: 'playfair400', size: 44, lineHeight: 1.35, color: INK },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'playfair400', size: 44, lineHeight: 1.35, color: INK },
      ],
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      top: 992,
      font: 'playfair400',
      size: 44,
      minSize: 24,
      maxWidth: 360,
      lineHeight: 1.35,
      color: INK,
      showWhen: '!dayText',
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      top: 1054,
      font: 'playfair400',
      size: 44,
      minSize: 28,
      maxWidth: 360,
      lineHeight: 1.35,
      color: INK,
      showWhen: 'timeText',
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1232,
      font: 'dancing700',
      size: 44,
      minSize: 24,
      maxWidth: 500,
      lineHeight: 1.35,
      color: HOT_PINK,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'lobster',
    titleSize: 74,
    titleColor: PINK,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#ffe3ef', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: PINK,
    ctaColor: '#ffffff',
    titleUppercase: false,
    titleStroke: { width: 2, color: '#ffffff' },
    titleShadow: { x: 3, y: 3, color: '#f7b6d6' },
    textColor: '#4a2340',
    hostColor: HOT_PINK,
    backdrop: 'linear-gradient(135deg, #ffd9ec 0%, #fff4f9 55%, #f9c6e1 100%)',
    portraitShadow: '0 10px 30px #c2397f55',
  },
}
