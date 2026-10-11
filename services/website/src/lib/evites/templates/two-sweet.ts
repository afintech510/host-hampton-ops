/**
 * The Donuts (Sweet) template, from Adam's Canva design "Pink Illustrative Two Sweet
 * Birthday Party Invitation" (DAG6YEbJ8AE, 480x672): a #fadfdf pink page with
 * watercolour donuts at the edges and confetti dots.
 *
 * The background is that design with every text element deleted (working copy
 * DAHXvuaNrvE, exported 2186x3060, scaled to 1093x1530 and cropped 4 px each side
 * to the 1085x1530 canvas). Canva top x 2.277 = canvas top, Canva left x 2.277 - 4 =
 * canvas left, font size x 2.277 = canvas size:
 *
 *   L O R N A (5 slots)   102.0 -> 232   124 -> 282   x 126..957, ink ~290..494
 *   is two sweet          213.4 -> 486  70.7 -> 161   ink ~540..725
 *   join us for a ...     325.5 -> 741  14.7 -> 33    ARCHED in Canva; set straight here
 *   06                    381.7 -> 869  53.3 -> 121   centre x 543
 *   august                439.5 -> 1001 26.7 -> 61
 *   sun/day | 20/88       413.3 -> 941  26.7 -> 61    centres x 254 | 832 (two lines each)
 *   start at 02 pm /      512.6 -> 1167 16.0 -> 36
 *     123 Anywhere St.
 *   rsvp @reallygreatsite 570.4 -> 1299 14.7 -> 33
 *
 * ...then tuned by eye. Fredoka is narrower than Canva's display face, so the name is
 * 230 (not 282) and its ink lands where LORNA's did.
 *
 * What changed from the design, and why:
 *   - LORNA is five overlapping text boxes alternating #d6426b / #f8afc5. A slot is one
 *     colour, so the name is deep pink with a light-pink hard offset shadow, which keeps
 *     the two-tone, overlapped feel without per-letter colour.
 *   - "is two sweet" is a pun that is only TRUE at age two ("is seven sweet" is not a
 *     phrase), and the renderer cannot test for one particular age. So the script line
 *     is "is turning" + `ageWords` ("is turning seven"), and "is celebrating" with no
 *     age. The donuts carry the "sweet" theme on their own. This is the brief's
 *     recommended option; a human may prefer to keep the pun for two-year-olds only,
 *     which would need an equality test in `showWhen`.
 *   - "JOIN US FOR A BIRTHDAY PARTY" is arched in Canva; here it is straight, and says
 *     what the party is: "JOIN US FOR A" + `themeWord` + "PARTY" (unthemed reads
 *     exactly as Canva did: "BIRTHDAY PARTY"). Canva's wide tracking is not reproduced:
 *     a row does not draw `letterSpacingEm` on its children.
 *   - The date block keeps its three columns: weekday | day over month | time. The
 *     year ("2088") was template filler and is dropped; the time takes its column, so
 *     the line below says only the place. A preview (no date) shows `dateLine`
 *     ("Pick your date") in the centre and nothing either side.
 *   - "RSVP @reallygreatsite" -> `hostContactLine` (guests RSVP online; the pink "RSVP"
 *     label is dropped because it would sit in front of "Any questions? ...").
 *   - Fonts: the name and date are Fredoka 700 (Canva's rounded display face); the
 *     thin white script is Dancing Script 700 (Neonderthaw is an outlined neon face and
 *     Great Vibes a hairline, and neither reads as white on this pink); the small caps
 *     lines are Montserrat 500.
 *   - White text on this pink is faint (as it is in Canva), so the white lettering
 *     carries a soft pink offset shadow.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const DEEP_PINK = '#d6426b'
const LIGHT_PINK = '#f8afc5'
const GREY = '#545454'
const WHITE = '#ffffff'
/** Behind white lettering, so it reads on #fadfdf. */
const WHITE_LIFT = { x: 3, y: 3, color: '#e597ad' }

export const TWO_SWEET_TEMPLATE: TemplateLayout = {
  slug: 'two-sweet',
  label: 'Donuts (Sweet)',
  source: { canvaDesignId: 'DAG6YEbJ8AE', canvaArtCopyId: 'DAHXvuaNrvE' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/two-sweet/background.webp', raster: '/evites/two-sweet/background.jpg' },
  backgroundColor: '#fadfdf',
  layers: [],
  slots: [
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreeDisplay',
      top: 262,
      font: 'fredoka700',
      size: 230,
      minSize: 80,
      maxWidth: 880,
      lineHeight: 1.15,
      uppercase: true,
      color: DEEP_PINK,
      shadow: { x: 12, y: 8, color: LIGHT_PINK },
    },
    {
      id: 'age_row',
      type: 'row',
      top: 492,
      gap: 26,
      maxWidth: 820,
      align: 'baseline',
      boxHeight: 166,
      showWhen: 'ageWords',
      children: [
        { id: 'turning_word', type: 'text', staticText: 'is turning', top: 0, font: 'dancing700', size: 128, minSize: 60, lineHeight: 1.3, color: WHITE, shadow: WHITE_LIFT },
        { id: 'age_words', type: 'text', bind: 'ageWords', top: 0, font: 'dancing700', size: 128, minSize: 60, lineHeight: 1.3, color: WHITE, shadow: WHITE_LIFT },
      ],
    },
    {
      id: 'celebrating_word',
      type: 'text',
      staticText: 'is celebrating',
      top: 492,
      font: 'dancing700',
      size: 128,
      minSize: 60,
      maxWidth: 820,
      lineHeight: 1.3,
      color: WHITE,
      shadow: WHITE_LIFT,
      showWhen: '!ageWords',
    },
    {
      id: 'invited_row',
      type: 'row',
      top: 780,
      gap: 10,
      maxWidth: 820,
      align: 'baseline',
      boxHeight: 45,
      children: [
        { id: 'invited_line', type: 'text', staticText: 'JOIN US FOR A', top: 0, font: 'montserrat500', size: 31, minSize: 18, lineHeight: 1.45, color: GREY },
        { id: 'theme_word', type: 'text', bind: 'themeWord', uppercase: true, top: 0, font: 'montserrat500', size: 31, minSize: 18, lineHeight: 1.45, color: GREY },
        { id: 'party_word', type: 'text', staticText: 'PARTY', top: 0, font: 'montserrat500', size: 31, minSize: 18, lineHeight: 1.45, color: GREY },
      ],
    },
    {
      id: 'date_weekday',
      type: 'text',
      bind: 'weekdayText',
      top: 938,
      box: { left: 70, width: 320, align: 'center' },
      font: 'fredoka700',
      size: 50,
      minSize: 28,
      maxWidth: 280,
      lineHeight: 1.1,
      uppercase: true,
      color: WHITE,
      shadow: WHITE_LIFT,
      showWhen: 'weekdayText',
    },
    {
      id: 'date_day',
      type: 'text',
      bind: 'dayText',
      top: 872,
      box: { left: 395, width: 300, align: 'center' },
      font: 'fredoka700',
      size: 121,
      lineHeight: 1.1,
      color: DEEP_PINK,
      showWhen: 'dayText',
    },
    {
      id: 'date_month',
      type: 'text',
      bind: 'monthText',
      top: 1003,
      box: { left: 395, width: 300, align: 'center' },
      font: 'fredoka700',
      size: 58,
      minSize: 34,
      maxWidth: 290,
      lineHeight: 1.1,
      uppercase: true,
      color: DEEP_PINK,
      showWhen: 'monthText',
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'timeText',
      top: 938,
      box: { left: 695, width: 320, align: 'center' },
      font: 'fredoka700',
      size: 50,
      minSize: 28,
      maxWidth: 280,
      lineHeight: 1.1,
      color: WHITE,
      shadow: WHITE_LIFT,
      showWhen: 'timeText',
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      top: 920,
      font: 'fredoka700',
      size: 70,
      minSize: 36,
      maxWidth: 800,
      lineHeight: 1.1,
      uppercase: true,
      color: DEEP_PINK,
      showWhen: '!dayText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1160,
      font: 'montserrat500',
      size: 32,
      minSize: 18,
      maxWidth: 790,
      lineHeight: 1.4,
      letterSpacingEm: 0.05,
      uppercase: true,
      color: GREY,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1240,
      font: 'montserrat500',
      size: 27,
      minSize: 16,
      maxWidth: 720,
      lineHeight: 1.4,
      letterSpacingEm: 0.05,
      uppercase: true,
      color: GREY,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'fredoka700',
    titleSize: 74,
    titleColor: DEEP_PINK,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#ffe8ee', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: DEEP_PINK,
    ctaColor: '#ffffff',
    titleUppercase: true,
    titleShadow: { x: 4, y: 3, color: LIGHT_PINK },
    textColor: '#5a2a3a',
    hostColor: DEEP_PINK,
    backdrop: 'linear-gradient(135deg, #fadfdf 0%, #fff3f5 55%, #fbe6d2 100%)',
    portraitShadow: '0 10px 30px #d6426b44',
  },
}
