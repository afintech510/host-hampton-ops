/**
 * The Saddle Up template, from Adam's Canva design "2394 Horse Birthday invitation"
 * (DAGU-eP3JJg, 480x672, page 1 of 2): a watercolour horse head on the right, a
 * cowgirl hat and boots bottom-left, pink roses in three corners.
 *
 * The background is that page with every text element deleted (working copy
 * DAHXvlo0aHs, exported 2186x3060, scaled to 1093x1530 and cropped 4 px each side
 * to the 1085x1530 canvas). So a Canva top x 2.277 is a canvas top, a Canva left
 * x 2.277 - 4 is a canvas left, and a font size x 2.277 is a canvas size:
 *
 *   Saddle (rot -7.8)   97.0 -> 221    81.3 -> 185   box x 4..523
 *   up!    (rot +5.8)  152.1 -> 346    84.4 -> 192   box x 158..439
 *   Aubrey             259.1 -> 590    61.1 -> 139   box x 26..502
 *   is turning 9       324.7 -> 739    46.4 -> 106
 *   JOIN US FOR A /    419.1 -> 954    13.3 -> 30    centre x 426
 *     SLIME PARTY!
 *   Wed november 27th  474.4 -> 1080    9.3 -> 21    centre x 555
 *   5:30-7:30pm        485.3 -> 1105   13.4 -> 31
 *   Host Hampton /     506.6 -> 1153   12.7 -> 29    centre x 575
 *     address, RSVP    528-562 -> 1202-1280
 *
 * ...then moved by eye. The name block keeps Canva's left column (all of it sits
 * in the white between the roses, the mane and the hat). The details block is
 * dropped ~40 px and centred at x 570 in the white pocket between the hat (right
 * edge ~360) and the roses (left edge ~760): Canva's "JOIN US FOR A" brushed the
 * horse's chin, and our faces are wider than Canva's. Every slot has a `box` so
 * nothing can grow into the horse.
 *
 * Fonts: Canva's brush script -> Kaushan Script (the brief's pick, and the
 * closest open brush face); Canva's serif -> Playfair Display.
 *
 * Wording (all bound but the slogans):
 *   - "Saddle up!" is a decorative slogan: static.
 *   - "Aubrey" -> `honoreeName` ("Mia" / "Birthday Star").
 *   - "is turning 9" -> "is turning" + `ageNumber`; with no age "is celebrating!".
 *   - "Join us for a SLIME PARTY!" -> "JOIN US FOR A" + `themeWord` + "PARTY!", so an
 *     unthemed party reads "BIRTHDAY PARTY!".
 *   - The date is the pieces (weekday, month, day), as Canva set it on one line, with
 *     the time on its own line below; a preview shows `dateLine` ("Pick your date").
 *   - "Host Hampton / 295 Montauk..." -> `placeLine` (one line, so it shrinks; Canva
 *     wrapped it in two). "RSVP TO KRISTA AT ..." -> `hostContactLine`.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { SlotBox, TemplateLayout } from '@/lib/evites/templates/types'

const PINK = '#ff8a9c'
const GOLD = '#d9a000'
const BROWN = '#794931'
const DEEP_PINK = '#e0607a'

/** The left column, beside the horse. */
const LEFT: SlotBox = { left: 25, width: 450, align: 'center' }
/** The lower-middle pocket between the hat and the roses. */
const DETAILS: SlotBox = { left: 370, width: 400, align: 'center' }
/** The place and host lines may use a little more of the pocket. */
const DETAILS_WIDE: SlotBox = { left: 355, width: 410, align: 'center' }

/** A soft white halo, so the script reads where it brushes the roses. */
const LIFT = { stops: [{ color: '#ffffff', radius: 4 }, { color: '#ffffff', radius: 10 }] }

export const SADDLE_UP_TEMPLATE: TemplateLayout = {
  slug: 'saddle-up',
  label: 'Saddle Up (Horse)',
  source: { canvaDesignId: 'DAGU-eP3JJg', canvaArtCopyId: 'DAHXvlo0aHs' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/saddle-up/background.webp', raster: '/evites/saddle-up/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'slogan_saddle',
      type: 'text',
      staticText: 'Saddle',
      top: 215,
      box: { left: 0, width: 500, align: 'center', rotateDeg: -7.8 },
      font: 'kaushan',
      size: 168,
      lineHeight: 1.4,
      color: PINK,
      glow: LIFT,
    },
    {
      id: 'slogan_up',
      type: 'text',
      staticText: 'up!',
      top: 340,
      box: { left: 170, width: 260, align: 'center', rotateDeg: 5.8 },
      font: 'kaushan',
      size: 192,
      lineHeight: 1.4,
      color: PINK,
      glow: LIFT,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeName',
      top: 585,
      box: LEFT,
      font: 'kaushan',
      size: 139,
      minSize: 52,
      maxWidth: 430,
      lineHeight: 1.4,
      color: PINK,
      glow: LIFT,
    },
    {
      id: 'age_row',
      type: 'row',
      top: 750,
      box: LEFT,
      gap: 20,
      maxWidth: 430,
      align: 'baseline',
      boxHeight: 120,
      showWhen: 'ageNumber',
      children: [
        { id: 'turning_word', type: 'text', staticText: 'is turning', top: 0, font: 'kaushan', size: 86, minSize: 50, lineHeight: 1.4, color: GOLD },
        { id: 'age', type: 'text', bind: 'ageNumber', top: 0, font: 'kaushan', size: 86, minSize: 50, lineHeight: 1.4, color: GOLD },
      ],
    },
    {
      id: 'celebrating_word',
      type: 'text',
      staticText: 'is celebrating!',
      top: 750,
      box: LEFT,
      font: 'kaushan',
      size: 80,
      minSize: 50,
      maxWidth: 430,
      lineHeight: 1.4,
      color: GOLD,
      showWhen: '!ageNumber',
    },
    {
      id: 'invited_line',
      type: 'text',
      staticText: 'JOIN US FOR A',
      top: 990,
      box: DETAILS,
      font: 'playfair700',
      size: 30,
      lineHeight: 1.3,
      letterSpacingEm: 0.04,
      color: GOLD,
    },
    {
      id: 'theme_row',
      type: 'row',
      top: 1030,
      box: DETAILS,
      gap: 12,
      maxWidth: 390,
      align: 'baseline',
      boxHeight: 46,
      children: [
        { id: 'theme_word', type: 'text', bind: 'themeWord', uppercase: true, top: 0, font: 'playfair700', size: 34, minSize: 20, lineHeight: 1.3, color: GOLD },
        { id: 'party_word', type: 'text', staticText: 'PARTY!', top: 0, font: 'playfair700', size: 34, minSize: 20, lineHeight: 1.3, color: GOLD },
      ],
    },
    {
      id: 'date_row',
      type: 'row',
      top: 1098,
      box: DETAILS,
      gap: 9,
      maxWidth: 390,
      align: 'baseline',
      boxHeight: 36,
      showWhen: 'dayText',
      children: [
        { id: 'date_weekday', type: 'text', bind: 'weekdayText', uppercase: true, top: 0, font: 'playfair700', size: 26, minSize: 16, lineHeight: 1.3, color: GOLD },
        { id: 'date_month', type: 'text', bind: 'monthText', uppercase: true, top: 0, font: 'playfair700', size: 26, minSize: 16, lineHeight: 1.3, color: GOLD },
        { id: 'date_day', type: 'text', bind: 'dayText', top: 0, font: 'playfair700', size: 26, minSize: 16, lineHeight: 1.3, color: GOLD },
      ],
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      top: 1098,
      box: DETAILS,
      font: 'playfair700',
      size: 26,
      minSize: 16,
      maxWidth: 390,
      lineHeight: 1.3,
      uppercase: true,
      color: GOLD,
      showWhen: '!dayText',
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'timeText',
      top: 1136,
      box: DETAILS,
      font: 'playfair700',
      size: 34,
      minSize: 20,
      maxWidth: 390,
      lineHeight: 1.3,
      color: DEEP_PINK,
      showWhen: 'timeText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1186,
      box: DETAILS_WIDE,
      font: 'playfair400',
      size: 26,
      minSize: 15,
      maxWidth: 405,
      lineHeight: 1.4,
      color: BROWN,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1226,
      box: DETAILS_WIDE,
      font: 'playfair400',
      size: 24,
      minSize: 15,
      maxWidth: 395,
      lineHeight: 1.4,
      color: BROWN,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'kaushan',
    titleSize: 74,
    titleColor: DEEP_PINK,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#fff1e0', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: DEEP_PINK,
    ctaColor: '#ffffff',
    titleUppercase: false,
    textColor: '#5a3524',
    hostColor: BROWN,
    backdrop: 'linear-gradient(135deg, #fff1f3 0%, #fffaf2 55%, #fbeedd 100%)',
    portraitShadow: '0 10px 30px #79493155',
  },
}
