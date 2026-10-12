/**
 * The Pink Pony Club template, from Adam's Canva design "Pink pony club invite"
 * (DAG2_CcIO70, 480x672).
 *
 * All of the art (doodles, disco ball, boots, pony, the scalloped cream label and the
 * "SADDLE UP FOR A" lettering) is ONE background image in Canva; only the six text
 * elements were separate, and they are deleted in the working copy DAHXvnomVYU
 * (exported 2186x3060, scaled to 1093x1530 and cropped 4 px each side). So
 * "SADDLE UP FOR A" stays as art: it is a decorative slogan, true for every party.
 * The art has faint smudges where earlier text was painted out of it (left column,
 * y 940-1200, under BIRTHDAY BASH!); the slots below cover them.
 *
 * Every `top` starts from the Canva element's own top x 2.277, every size from its
 * font size x 2.277, every x from its left x 2.277 - 4:
 *
 *   You're invited to    90.5 -> 206     28.0 -> 64
 *   SOPHIAS/PINK/        116.5 -> 265     63.0 -> 143  (4 lines, line-height 1.02 -> 146 apart)
 *     PONY/CLUB
 *   7th                  404.3 -> 920     53.7 -> 122  (left column)
 *   BIRTHDAY / BASH!     460.1 -> 1048    40.0 -> 91   (left column x 63-527: the `box`)
 *   November 15th/1-3pm  559.3 -> 1273    18.7 -> 42   (inside the label)
 *   HOST HAMPTON/...     605.2 -> 1378    14.7 -> 33   (inside the label)
 *
 * ...then tuned by eye. The label's flat interior is about x 105-505, y 1240-1490, so
 * its slots share a box centred on x 305 and nothing in it is wider than 380.
 *
 * Fonts: Canva's bold stencil-serif -> Stardos Stencil 700 (title, "You're invited
 * to", BIRTHDAY BASH!); its brush script "7th" -> Kaushan Script; the label's rounded
 * sans -> Poppins.
 *
 * Wording: "SOPHIAS" is the name -> `honoreePossessive`, upper-cased ("MIA'S", and with
 * no name "OUR BIRTHDAY STAR'S"); "PINK PONY CLUB" stays static. "7th" ->
 * `ageOrdinal`; with no age the column reads "SADDLE UP FOR A / BIRTHDAY BASH!".
 * The label's date is [weekday] / [month day] / [time]; with no date, `dateLine`.
 * Canva's label had no RSVP line, so the host contact line sits under the label in
 * the same plum, small, rather than being dropped (guests need someone to ask).
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const RASPBERRY = '#ca2267'
const BUBBLEGUM = '#fe5b9e'
const PLUM = '#b8246e'

/** The left column under "SADDLE UP FOR A" (Canva's BIRTHDAY BASH! box, x 63-527). */
const LEFT_COLUMN = { left: 63, width: 464, align: 'center' as const }
/** The scalloped label's flat interior, centred on x 305. */
const LABEL = { left: 105, width: 400, align: 'center' as const }

/** The strip under the pony's hooves, beside the label (x 555-1055, y 1410-1520). */
const UNDER_PONY = { left: 555, width: 500, align: 'center' as const }

const TITLE_LINE = { font: 'stardos700' as const, size: 143, lineHeight: 1.02, color: RASPBERRY }

export const PINK_PONY_TEMPLATE: TemplateLayout = {
  slug: 'pink-pony',
  label: 'Pink Pony Club',
  source: { canvaDesignId: 'DAG2_CcIO70', canvaArtCopyId: 'DAHXvnomVYU' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/pink-pony/background.webp', raster: '/evites/pink-pony/background.jpg' },
  backgroundColor: '#fdaccd',
  layers: [],
  slots: [
    {
      id: 'invited_line',
      type: 'text',
      staticText: "You're invited to",
      // 6 px above Canva's: an accented capital in the name line ("ZOË'S") reaches up into it.
      top: 186,
      font: 'stardos700',
      size: 64,
      lineHeight: 1.1,
      color: RASPBERRY,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      uppercase: true,
      top: 268,
      ...TITLE_LINE,
      minSize: 56,
      // x 222-862: clear of the outline star doodle at x 865-935 on this line's height.
      maxWidth: 640,
    },
    { id: 'pink_word', type: 'text', staticText: 'PINK', top: 414, ...TITLE_LINE },
    { id: 'pony_word', type: 'text', staticText: 'PONY', top: 560, ...TITLE_LINE },
    { id: 'club_word', type: 'text', staticText: 'CLUB', top: 706, ...TITLE_LINE },
    {
      id: 'age',
      type: 'text',
      bind: 'ageOrdinal',
      top: 952,
      // Canva's "7th" is centred at x 276, left of the column's centre; a little further left here so
      // a two-digit age ("12th") stays clear of the star doodle at x 380-425.
      box: { left: 20, width: 464, align: 'center' },
      font: 'kaushan',
      size: 112,
      minSize: 70,
      maxWidth: 400,
      lineHeight: 1.05,
      color: BUBBLEGUM,
      showWhen: 'ageOrdinal',
    },
    {
      id: 'birthday_word',
      type: 'text',
      staticText: 'BIRTHDAY',
      top: 1062,
      box: LEFT_COLUMN,
      font: 'stardos700',
      size: 92,
      minSize: 60,
      maxWidth: 464,
      lineHeight: 1.02,
      color: RASPBERRY,
    },
    {
      id: 'bash_word',
      type: 'text',
      staticText: 'BASH!',
      top: 1156,
      box: LEFT_COLUMN,
      font: 'stardos700',
      size: 92,
      lineHeight: 1.02,
      color: RASPBERRY,
    },
    {
      id: 'weekday',
      type: 'text',
      bind: 'weekdayText',
      top: 1270,
      box: LABEL,
      font: 'poppins600',
      size: 34,
      lineHeight: 1.3,
      color: PLUM,
      showWhen: 'dayText',
    },
    {
      id: 'month_day_row',
      type: 'row',
      top: 1312,
      box: LABEL,
      gap: 12,
      maxWidth: 380,
      align: 'baseline',
      boxHeight: 62,
      showWhen: 'dayText',
      children: [
        { id: 'month', type: 'text', bind: 'monthText', top: 0, font: 'poppins600', size: 46, lineHeight: 1.3, color: PLUM },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'poppins600', size: 46, lineHeight: 1.3, color: PLUM },
      ],
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      top: 1314,
      box: LABEL,
      font: 'poppins600',
      size: 44,
      minSize: 24,
      maxWidth: 380,
      lineHeight: 1.3,
      color: PLUM,
      showWhen: '!dayText',
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      top: 1374,
      box: LABEL,
      font: 'poppins600',
      size: 38,
      minSize: 24,
      maxWidth: 380,
      lineHeight: 1.3,
      color: PLUM,
      showWhen: 'timeText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1416,
      box: UNDER_PONY,
      font: 'poppins600',
      size: 26,
      minSize: 16,
      maxWidth: 470,
      lineHeight: 1.4,
      color: PLUM,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1460,
      box: UNDER_PONY,
      font: 'poppins400',
      size: 24,
      minSize: 16,
      maxWidth: 470,
      lineHeight: 1.4,
      color: PLUM,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'stardos700',
    titleSize: 74,
    titleColor: RASPBERRY,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#ffe3ef', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: RASPBERRY,
    ctaColor: '#ffffff',
    titleUppercase: true,
    textColor: '#5a1838',
    hostColor: PLUM,
    backdrop: 'linear-gradient(135deg, #ffc2dc 0%, #fff0f6 55%, #fdaccd 100%)',
    portraitShadow: '0 10px 30px #b8246e55',
  },
}
