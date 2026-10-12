/**
 * The Watercolor Mermaid template, from Adam's Canva design "Turquoise and Pink
 * Watercolor Mermaid Birthday Invitation" (DAHRdqsAJoY, 480x672): a turquoise and
 * pink tail, fish, a seahorse, coral and an open shell on a lavender-to-cream wash.
 *
 * The background is that design with every text element and the four thin rules
 * either side of the date row deleted (working copy DAHXvu1i5Do, exported
 * 2186x3060, scaled to 1093x1530 and cropped 4 px each side). A Canva top x 2.277
 * is our top; a size x 2.277 is ours:
 *
 *   YOU ARE INVITED TO          260.8 -> 594    16.0 -> 36   (lilac, bold, tracked)
 *   MADEYLYN & BROOKLYN'S       288.4 -> 657    37.3 -> 85   (blue chunky display)
 *   10TH BIRTHDAY               341.9 -> 779    56.0 -> 128
 *   SATURDAY | 22 | 11am-..     400.4 -> 912    16.0 -> 36 / 44.9 -> 102 for the day
 *   AUGUST                      449.0 -> 1022   16.0 -> 36
 *   Host Hampton / 295 .. (3)   484.2 -> 1102   16.0 -> 36   centre x 534
 *   RSVP to Haley / (934) ..    582.6 -> 1327   16.0 -> 36
 *
 * What changed, and why: below y ~1090 the only clear space is a ~370 px column
 * between the coral and the shell, which held Canva's three-line place block and
 * two-line RSVP. Ours are ONE line each ("Host Hampton . 295 Montauk Hwy, Speonk",
 * "Any questions? Ask Allie . 631-998-9325"), which would shrink to nothing there.
 * So the whole block moves up ~35 px and is set tighter, and the place and host
 * lines sit in the clear band above the coral and the shell's splash (y ~995-1080). The
 * bottom of the card is left to the art.
 *
 * Canva's display face is a chunky retro sans with no open twin; Fredoka 700 is
 * the closest chunky rounded one. The small caps lines are Montserrat 800, the big
 * day number Fredoka 700 in lilac (Canva set it in a bold serif, but Playfair's
 * old-style figures drop the 4 and 9 below the line). The ordinal
 * cannot be a superscript ("10TH", not "10" + raised "TH"): one bound string.
 *
 * Wording: "10TH BIRTHDAY" is the bound ordinal + static "BIRTHDAY" (just
 * "BIRTHDAY" with no age). The date row is the pieces with showWhen 'dayText', and
 * the month line below it is shown only with a date; a preview shows `dateLine`
 * ("Pick your date") in their place. "RSVP to Haley ..." becomes the host contact
 * line.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const BLUE = '#004aad'
const LILAC = '#915ab1'

export const MERMAID_TEMPLATE: TemplateLayout = {
  slug: 'mermaid',
  label: 'Watercolor Mermaid',
  source: { canvaDesignId: 'DAHRdqsAJoY', canvaArtCopyId: 'DAHXvu1i5Do' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/mermaid/background.webp', raster: '/evites/mermaid/background.jpg' },
  backgroundColor: '#f3e6f6',
  layers: [],
  slots: [
    {
      id: 'invited_line',
      type: 'text',
      staticText: 'YOU ARE INVITED TO',
      top: 560,
      font: 'montserrat800',
      size: 34,
      lineHeight: 1.4,
      letterSpacingEm: 0.04,
      color: LILAC,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      uppercase: true,
      top: 604,
      font: 'fredoka700',
      size: 86,
      minSize: 44,
      // Not Canva's full width: at this height the tail reaches x ~200-290, and blue on teal does not read.
      maxWidth: 640,
      lineHeight: 1.25,
      color: BLUE,
    },
    {
      id: 'age_row',
      type: 'row',
      top: 700,
      gap: 28,
      maxWidth: 1000,
      align: 'baseline',
      boxHeight: 140,
      children: [
        { id: 'age', type: 'text', bind: 'ageOrdinal', uppercase: true, top: 0, font: 'fredoka700', size: 120, lineHeight: 1.2, color: BLUE, showWhen: 'ageOrdinal' },
        { id: 'birthday_word', type: 'text', staticText: 'BIRTHDAY', top: 0, font: 'fredoka700', size: 120, lineHeight: 1.2, color: BLUE },
      ],
    },
    {
      id: 'date_row',
      type: 'row',
      top: 838,
      gap: 30,
      maxWidth: 900,
      align: 'center',
      boxHeight: 110,
      showWhen: 'dayText',
      children: [
        { id: 'weekday', type: 'text', bind: 'weekdayText', uppercase: true, top: 0, font: 'montserrat800', size: 36, lineHeight: 1.4, letterSpacingEm: 0.02, color: BLUE },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'fredoka700', size: 92, lineHeight: 1.2, color: LILAC },
        { id: 'time', type: 'text', bind: 'timeText', top: 0, font: 'montserrat800', size: 36, lineHeight: 1.4, color: BLUE, showWhen: 'timeText' },
      ],
    },
    {
      id: 'month',
      type: 'text',
      bind: 'monthText',
      uppercase: true,
      showWhen: 'dayText',
      top: 940,
      font: 'montserrat800',
      size: 36,
      lineHeight: 1.4,
      letterSpacingEm: 0.02,
      color: BLUE,
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      showWhen: '!dayText',
      top: 868,
      font: 'montserrat800',
      size: 40,
      minSize: 26,
      maxWidth: 800,
      lineHeight: 1.4,
      letterSpacingEm: 0.02,
      color: BLUE,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 994,
      font: 'montserrat800',
      size: 32,
      minSize: 22,
      maxWidth: 660,
      lineHeight: 1.4,
      color: LILAC,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      showWhen: 'hostContactLine',
      top: 1038,
      font: 'montserrat800',
      size: 30,
      minSize: 22,
      maxWidth: 640,
      lineHeight: 1.4,
      color: LILAC,
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'fredoka700',
    titleSize: 74,
    titleColor: BLUE,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#e0f6f4', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: '#2aa6a0',
    ctaColor: '#ffffff',
    titleUppercase: false,
    textColor: '#2e2550',
    hostColor: LILAC,
    backdrop: 'linear-gradient(135deg, #eedbff 0%, #f6f0f6 50%, #fff9e2 100%)',
    portraitShadow: '0 10px 30px #4a3a8a44',
  },
}
