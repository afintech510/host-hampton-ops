/**
 * The Honk, Beep, Vroom template, from Adam's Canva design "Copy of
 * Transportation birthday invite" (DAGUlpNxCgE, 480x672).
 *
 * The background is that design with every text element deleted (working copy
 * DAHXvnYxOTs, exported 2186x3060, scaled to 1093x1530 and cropped 4 px each
 * side). The watercolour vehicles around the border and the aeroplane in the
 * middle are art.
 *
 * Canva's geometry, as glyph centres measured off the Canva thumbnail (x 2.898),
 * which here is closer than element tops x 2.277 because Canva's hand-lettered
 * caps sit high in a tall line box:
 *
 *   honk, beep, vroom          -> 142    41.0 -> 93 (Canva size; the ink is ~64)
 *   zoom over for some fun!    -> 258
 *   (aeroplane art 304..522)
 *   Luke                       -> 605    39.0 -> 89 (Canva size; the ink is a 130 Kaushan)
 *   is turning                 -> 735
 *   2 years old!               -> 804
 *   Join us to celebrate       -> 913
 *   Saturday, December 7, 2024 / 3:00-5:00pm / Host Hampton / address / RSVP
 *                              -> 994 / 1049 / 1101 / 1153..1203 / 1252, 16 -> 36
 *
 * Fonts: Canva's hand-lettered small caps have no close open face in the
 * palette; Fredoka 600 in capitals keeps the round, friendly kid look. The name
 * is Kaushan Script (brush), the details Poppins 400.
 *
 * What changed, and why:
 *   - The date and time were two lines; `dateLine` is one ("Saturday, November
 *     14 · 2–4 PM"), so the block is date, place, host: three lines, centred in
 *     the column the vehicles leave (~560 px wide below the tractor).
 *   - "2 years old!" is a row: `ageNumber` + `yearsOld` (upper-cased; age 1 reads
 *     "1 YEAR OLD"), under a static "IS TURNING"; with no age both go and the card
 *     reads "IS HAVING A PARTY!". Canva's "!" is dropped: it cannot follow a
 *     bound word without a row gap in front of it.
 *   - "RSVP: to Kayla <phone>" is `hostContactLine` (guests RSVP online; the line
 *     names Allie).
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const BLUE = '#302dbb'
const ORANGE = '#ee523c'
const GREEN = '#37923d'
const INK = '#1a1a1a'

export const VROOM_TEMPLATE: TemplateLayout = {
  slug: 'vroom',
  label: 'Honk, Beep, Vroom',
  source: { canvaDesignId: 'DAGUlpNxCgE', canvaArtCopyId: 'DAHXvnYxOTs' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/vroom/background.webp', raster: '/evites/vroom/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'slogan',
      type: 'text',
      staticText: 'HONK, BEEP, VROOM',
      top: 106,
      font: 'fredoka600',
      size: 58,
      lineHeight: 1.2,
      letterSpacingEm: 0.03,
      color: BLUE,
    },
    {
      id: 'slogan_sub',
      type: 'text',
      staticText: 'ZOOM OVER FOR SOME FUN!',
      top: 233,
      font: 'fredoka600',
      size: 40,
      lineHeight: 1.2,
      letterSpacingEm: 0.03,
      color: ORANGE,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeName',
      top: 520,
      font: 'kaushan',
      size: 130,
      minSize: 60,
      maxWidth: 600,
      lineHeight: 1.3,
      color: GREEN,
    },
    {
      id: 'turning_word',
      type: 'text',
      staticText: 'IS TURNING',
      top: 701,
      font: 'fredoka600',
      size: 54,
      lineHeight: 1.2,
      letterSpacingEm: 0.02,
      color: BLUE,
      showWhen: 'ageNumber',
    },
    {
      id: 'age_row',
      type: 'row',
      top: 768,
      gap: 16,
      maxWidth: 580,
      align: 'baseline',
      boxHeight: 72,
      showWhen: 'ageNumber',
      children: [
        { id: 'age_number', type: 'text', bind: 'ageNumber', top: 0, font: 'fredoka600', size: 60, minSize: 34, lineHeight: 1.2, color: BLUE },
        { id: 'years_old', type: 'text', bind: 'yearsOld', uppercase: true, top: 0, font: 'fredoka600', size: 60, minSize: 34, lineHeight: 1.2, color: BLUE },
      ],
    },
    {
      id: 'party_no_age',
      type: 'text',
      staticText: 'IS HAVING A PARTY!',
      top: 736,
      font: 'fredoka600',
      size: 54,
      minSize: 30,
      maxWidth: 580,
      lineHeight: 1.2,
      letterSpacingEm: 0.02,
      color: BLUE,
      showWhen: '!ageNumber',
    },
    {
      id: 'celebrate_line',
      type: 'text',
      staticText: 'JOIN US TO CELEBRATE',
      top: 887,
      font: 'fredoka600',
      size: 42,
      lineHeight: 1.2,
      letterSpacingEm: 0.03,
      color: ORANGE,
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'dateLine',
      top: 975,
      font: 'poppins400',
      size: 36,
      minSize: 20,
      maxWidth: 600,
      lineHeight: 1.4,
      color: INK,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1042,
      font: 'poppins400',
      size: 34,
      minSize: 18,
      maxWidth: 560,
      lineHeight: 1.4,
      color: INK,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1104,
      font: 'poppins400',
      size: 32,
      minSize: 18,
      maxWidth: 540,
      lineHeight: 1.4,
      color: INK,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'kaushan',
    titleSize: 74,
    titleColor: GREEN,
    glow: { stops: [{ color: '#ffffff', radius: 4 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: BLUE,
    ctaColor: '#ffffff',
    titleUppercase: false,
    textColor: '#23305e',
    hostColor: ORANGE,
    backdrop: 'linear-gradient(135deg, #e6f0fb 0%, #ffffff 55%, #fdece4 100%)',
    portraitShadow: '0 10px 30px #302dbb44',
  },
}
