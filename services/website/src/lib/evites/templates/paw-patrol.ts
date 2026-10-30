/**
 * The Paw Patrol template, from Adam's Canva design "Copy of paw patrol 8"
 * (DAHZfdJwGiQ, 480x672, page 1): six watercolour pups round the edge, the PAW
 * PATROL shield and "ALL PAWS ON DECK" at the top, three blue paw-print rules
 * down the middle.
 *
 * The background is that design with every text element deleted (working copy
 * DAHZftCvh0Q, exported 2186x3060, scaled to 1093x1530 and cropped 4 px each
 * side). The shield, the slogan, the sparkle marks either side of "IS TURNING"
 * and the paw rules are all one image, so they stay. A Canva top x 2.277 is ours,
 * as is a font size:
 *
 *   Luke          296.9 -> 676    81.7 -> 186
 *   IS TURNING    386.0 -> 879    34.6 -> 79
 *   4             371.4 -> 846    59.4 -> 135
 *   December 5    441.2 -> 1005   22.0 -> 50
 *   4:00 pm ...   488.2 -> 1112   19.2 -> 44
 *   Host hampton  536.8 -> 1222   20.6 -> 47 / 16 -> 36 (two lines; ours is one)
 *   RSVP TO ...   614.9 -> 1400   18.7 -> 42
 *
 * The rules measure at y 1077, 1191 and 1366 on our canvas (paws at 1063, 1172,
 * 1347), so each line is centred in its band: date above the first rule, time
 * between the first two, place between the second and third, host line below.
 * Widths are measured off the art: the pups leave ~540 px at the name and the
 * place, and the sparkle marks bracket the age row at x ~300..770.
 *
 * Canva's rounded display face -> Fredoka 700; its rounded caps -> Fredoka 600,
 * upper-cased and spaced. Colours are Canva's own.
 *
 * Wording: "Luke" is `honoreeDisplay`; "IS TURNING 4" is a static word plus
 * `ageNumber`, and with no age it reads "IS HAVING A PARTY!" (as Construction
 * does). "December 5" becomes weekday - month day; a preview shows `dateLine`
 * ("Pick your date") there instead, and the time hides itself. "RSVP TO KAYLA
 * <phone>" is the host contact line (guests RSVP online; the line names Allie).
 *
 * Paw Patrol is a licensed character: Adam's call, as for Stitch and Minecraft.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const BLUE = '#0e6cca'
const RED = '#f03a3c'
const GREEN = '#2f7d31'
const ORANGE = '#fd731a'

/** Between the sparkle marks either side of the age row. */
const AGE_WIDTH = 450
/** Rocky's ear and Zuma's helmet leave x ~265..822 at the place line: centred a little right of the page. */
const PLACE_BOX = { left: 270, width: 550, align: 'center' as const }

export const PAW_PATROL_TEMPLATE: TemplateLayout = {
  slug: 'paw-patrol',
  label: 'Paw Patrol',
  source: { canvaDesignId: 'DAHZfdJwGiQ', canvaArtCopyId: 'DAHZftCvh0Q' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/paw-patrol/background.webp', raster: '/evites/paw-patrol/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeDisplay',
      uppercase: true,
      top: 676,
      font: 'fredoka700',
      size: 176,
      minSize: 70,
      maxWidth: 530,
      lineHeight: 1.1,
      color: BLUE,
    },
    {
      id: 'age_row',
      type: 'row',
      top: 846,
      gap: 22,
      maxWidth: AGE_WIDTH,
      align: 'baseline',
      boxHeight: 160,
      showWhen: 'ageNumber',
      children: [
        { id: 'turning_word', type: 'text', staticText: 'IS TURNING', top: 0, font: 'fredoka600', size: 72, minSize: 40, lineHeight: 1.2, color: RED },
        { id: 'age', type: 'text', bind: 'ageNumber', top: 0, font: 'fredoka700', size: 128, minSize: 70, lineHeight: 1.2, color: RED },
      ],
    },
    {
      id: 'party_no_age',
      type: 'text',
      staticText: 'IS HAVING A PARTY!',
      top: 882,
      font: 'fredoka600',
      size: 64,
      minSize: 34,
      maxWidth: AGE_WIDTH,
      lineHeight: 1.2,
      color: RED,
      showWhen: '!ageNumber',
    },
    {
      id: 'date_row',
      type: 'row',
      top: 1000,
      gap: 14,
      maxWidth: 640,
      align: 'baseline',
      boxHeight: 60,
      showWhen: 'dayText',
      children: [
        { id: 'weekday', type: 'text', bind: 'weekdayText', uppercase: true, top: 0, font: 'fredoka600', size: 46, minSize: 26, lineHeight: 1.3, letterSpacingEm: 0.06, color: BLUE },
        { id: 'date_dash', type: 'text', staticText: '-', top: 0, font: 'fredoka600', size: 46, minSize: 26, lineHeight: 1.3, color: BLUE },
        { id: 'month', type: 'text', bind: 'monthText', uppercase: true, top: 0, font: 'fredoka600', size: 46, minSize: 26, lineHeight: 1.3, letterSpacingEm: 0.06, color: BLUE },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'fredoka600', size: 46, minSize: 26, lineHeight: 1.3, letterSpacingEm: 0.06, color: BLUE },
      ],
    },
    {
      // A preview has no date pieces: "Pick your date" where the row would be.
      id: 'date_line',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 1000,
      font: 'fredoka600',
      size: 46,
      minSize: 26,
      maxWidth: 640,
      lineHeight: 1.3,
      letterSpacingEm: 0.06,
      color: BLUE,
      showWhen: '!dayText',
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      uppercase: true,
      top: 1104,
      font: 'fredoka600',
      size: 44,
      minSize: 26,
      maxWidth: 620,
      lineHeight: 1.3,
      letterSpacingEm: 0.06,
      color: RED,
      showWhen: 'timeText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1262,
      box: PLACE_BOX,
      font: 'fredoka600',
      size: 38,
      minSize: 20,
      maxWidth: 540,
      lineHeight: 1.3,
      color: GREEN,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1392,
      font: 'fredoka600',
      size: 36,
      minSize: 20,
      maxWidth: 600,
      lineHeight: 1.3,
      letterSpacingEm: 0.03,
      color: ORANGE,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'fredoka700',
    titleSize: 74,
    titleColor: BLUE,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#e1efff', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: RED,
    ctaColor: '#ffffff',
    textColor: '#1f2f45',
    hostColor: ORANGE,
    backdrop: 'linear-gradient(135deg, #e1efff 0%, #ffffff 55%, #ffe9dc 100%)',
    portraitShadow: '0 10px 30px #0e6cca44',
  },
}
