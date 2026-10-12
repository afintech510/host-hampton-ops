/**
 * The Neon Slime template, from page 1 of Adam's Canva design "Slime-Party-Invite"
 * (DAGRD4mis44, 480x672, 5 pages).
 *
 * The drippy rainbow "SLIME" is NOT a text element: it is painted into the
 * design's one full-page, locked background image (LB1zbNVdwjYGXHWy), together
 * with the splats, the neon hearts and the two pink drip bars. So it stays as art
 * - this template IS the slime design - and the word under it, "PARTY", is static
 * rather than `themeSub` (it belongs to the painted SLIME). Every other element
 * was text and was deleted (working copy DAHXvi6ygTE, exported 2186x3060, scaled
 * to 1093x1530 and cropped 4 px each side). x = Canva x x 2.277 - 4, top = Canva
 * top x 2.277, size = Canva size x 2.277:
 *
 *   IT'S TIME FOR A          55.0 -> 125    37.3 -> 85
 *   (SLIME, painted)         caps at ~235-500
 *   PARTY                   217.0 -> 494    47.6 -> 108
 *   JOIN US TO CELEBRATE    264.9 -> 603    32.0 -> 73
 *   SADIE & / HANNAH        290.3 -> 661    69.5 -> 158 x two lines (per-letter colours)
 *   TURNING 10 !            420.5 -> 957    37.1 -> 85
 *   Saturday (turned -90)   centre (61, 514) -> (136, 1171)   16.3 -> 37
 *   19                      centre (96, 514) -> (215, 1171)   58.3 -> 133, yellow
 *   October                 centre (98, 543) -> (219, 1235)   14.8 -> 34
 *   wordmark + address      between the drip bars, 458-547 -> 1042-1245 (deleted)
 *   1:00 pm / To / 3:00 pm  right of the right drip, centre x 386 -> 875, 482.6 -> 1099
 *   Please RSVP ...         593.8 -> 1352   17.3 -> 39.5, two lines
 *
 * What changed, and why:
 *   - One name line instead of two, and it is `honoreeDisplay` drawn with a
 *     gradient `fill` of the five letter colours Canva used per character (lime,
 *     cyan, pink, yellow, orange): the renderer has no per-letter colour.
 *   - "TURNING 10 !" is a row: "TURNING" + `ageNumber` + "!", shown only with an age.
 *   - The date strip between the drip bars was venue | date | time with the venue
 *     in the MIDDLE. `placeLine` is one line of up to ~50 characters and the gap
 *     between the drips is ~345 px, so it would print at ~16 px. So the strip is
 *     weekday (turned -90, as Canva) | big yellow day over the month (centred
 *     between the drips) | time; and the place and the contact line run full width
 *     below the drips, where Canva had its RSVP. A design with no date yet shows
 *     `dateLine` ("Pick your date") between the drips instead.
 *   - Canva's rounded face is approximated by Fredoka; its neon look (white-ish
 *     fill, coloured halo) by `glow`.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { Glow, TemplateLayout } from '@/lib/evites/templates/types'

function halo(inner: string, outer: string): Glow {
  return { stops: [{ color: inner, radius: 6 }, { color: outer, radius: 18 }] }
}

const PINK = '#f60c79'
const VIOLET = '#7a3cff'
const YELLOW = '#ffe523'
const WHITE = '#fff4fb'

const PINK_GLOW = halo('#ff4fa3', PINK)
const VIOLET_GLOW = halo('#9a6bff', '#5e17eb')

export const SLIME_NEON_TEMPLATE: TemplateLayout = {
  slug: 'slime-neon',
  label: 'Neon Slime',
  source: { canvaDesignId: 'DAGRD4mis44', canvaArtCopyId: 'DAHXvi6ygTE' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/slime-neon/background.webp', raster: '/evites/slime-neon/background.jpg' },
  backgroundColor: '#0d0230',
  layers: [],
  slots: [
    {
      id: 'kicker',
      type: 'text',
      staticText: "It's time for a",
      uppercase: true,
      top: 125,
      font: 'fredoka600',
      size: 85,
      lineHeight: 1,
      color: WHITE,
      glow: PINK_GLOW,
    },
    {
      id: 'party_word',
      type: 'text',
      staticText: 'PARTY',
      top: 494,
      font: 'fredoka600',
      size: 108,
      lineHeight: 1,
      color: WHITE,
      glow: PINK_GLOW,
    },
    {
      id: 'celebrate_line',
      type: 'text',
      staticText: 'Join us to celebrate',
      uppercase: true,
      top: 610,
      font: 'fredoka600',
      size: 73,
      lineHeight: 1,
      color: WHITE,
      glow: VIOLET_GLOW,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeDisplay',
      top: 715,
      font: 'fredoka700',
      size: 190,
      minSize: 80,
      maxWidth: 840,
      lineHeight: 1.1,
      // The five colours repeat every ~45% of the canvas, so a three-letter name still shows three of them.
      fill: { gradient: ['#69ec1a 30%', '#0cc0df 39%', '#ff258b 48%', '#ffe523 57%', '#ff6100 66%', '#69ec1a 75%', '#0cc0df 84%', '#ff258b 93%'], angleDeg: 90 },
      glow: { stops: [{ color: '#ffffff', radius: 3 }, { color: '#b36bff', radius: 16 }] },
    },
    {
      id: 'age_row',
      type: 'row',
      top: 947,
      gap: 22,
      maxWidth: 900,
      align: 'baseline',
      showWhen: 'ageNumber',
      children: [
        { id: 'turning_word', type: 'text', staticText: 'TURNING', top: 0, font: 'fredoka600', size: 85, lineHeight: 1.1, color: WHITE, glow: VIOLET_GLOW },
        { id: 'age', type: 'text', bind: 'ageNumber', top: 0, font: 'fredoka600', size: 85, lineHeight: 1.1, color: WHITE, glow: VIOLET_GLOW },
        { id: 'bang', type: 'text', staticText: '!', top: 0, font: 'fredoka600', size: 85, lineHeight: 1.1, color: WHITE, glow: VIOLET_GLOW },
      ],
    },
    // ---- the strip between the drip bars (drips at x ~280-360 and ~725-805, y ~1050-1280)
    {
      id: 'weekday',
      type: 'text',
      bind: 'weekdayText',
      uppercase: true,
      top: 1141,
      box: { left: 100, width: 220, align: 'center', rotateDeg: -90 },
      font: 'fredoka600',
      size: 40,
      minSize: 26,
      maxWidth: 210,
      lineHeight: 1.2,
      color: WHITE,
      glow: PINK_GLOW,
    },
    {
      id: 'day',
      type: 'text',
      bind: 'dayText',
      top: 1058,
      box: { left: 365, width: 355, align: 'center' },
      font: 'fredoka700',
      size: 140,
      lineHeight: 1,
      color: YELLOW,
      glow: halo('#fff27a', '#ff9d00'),
    },
    {
      id: 'month',
      type: 'text',
      bind: 'monthText',
      uppercase: true,
      top: 1200,
      box: { left: 365, width: 355, align: 'center' },
      font: 'fredoka600',
      size: 40,
      minSize: 26,
      maxWidth: 340,
      lineHeight: 1.2,
      color: WHITE,
      glow: PINK_GLOW,
    },
    {
      id: 'no_date',
      type: 'text',
      bind: 'dateLine',
      showWhen: '!dayText',
      top: 1135,
      box: { left: 365, width: 355, align: 'center' },
      font: 'fredoka600',
      size: 44,
      minSize: 26,
      maxWidth: 340,
      lineHeight: 1.2,
      color: YELLOW,
      glow: halo('#fff27a', '#ff9d00'),
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      showWhen: 'timeText',
      top: 1141,
      box: { left: 770, width: 220, align: 'center', rotateDeg: 90 },
      font: 'fredoka600',
      size: 40,
      minSize: 26,
      maxWidth: 210,
      lineHeight: 1.2,
      color: WHITE,
      glow: PINK_GLOW,
    },
    // ---- below the drips, where Canva's RSVP was
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1296,
      font: 'fredoka600',
      size: 34,
      minSize: 22,
      maxWidth: 640,
      lineHeight: 1.3,
      color: YELLOW,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      showWhen: 'hostContactLine',
      top: 1352,
      font: 'fredoka600',
      size: 30,
      minSize: 22,
      maxWidth: 540,
      lineHeight: 1.3,
      color: WHITE,
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'fredoka700',
    titleSize: 74,
    titleColor: YELLOW,
    glow: halo('#ff4fa3', PINK),
    ctaText: 'Tap to RSVP',
    ctaBg: '#69ec1a',
    ctaColor: '#0d0230',
  },
}
