/**
 * The Hello Kitty template, from Adam's Canva design "KITTY INVITATION"
 * (DAGt5bSmvao, 480x672).
 *
 * The background is that design with every text element deleted (working copy
 * DAHXvt6Vkyk, exported 2186x3060, scaled to 1093x1530 and cropped 4 px each side),
 * EXCEPT "YOU ARE INVITED": that element is LOCKED in Canva and the API refuses to
 * delete a locked element. It is static wording this template would set identically,
 * so it stays in the art and no slot draws it. The pale ribbon band behind the name
 * is image art and stays. So every `top` below starts from the Canva element's own
 * top x 2.277, and every size from its font size x 2.277:
 *
 *   YOU ARE INVITED     15.9 -> 36                     (baked into the art, see above)
 *   Hensley's          376.1 -> 856     46.7 -> 106
 *   5th BIRTHDAY       446.8 -> 1017    32.4 -> 74    (letter-spacing 0.29 em)
 *   iT'S A SPA PARTY!  493.0 -> 1122    22.7 -> 52
 *   SUNDAY - SEPT 14   542.4 -> 1235    20.0 -> 46
 *   1:00-3:00PM        569.4 -> 1296    20.0 -> 46
 *   HOST HAMPTON /     600.4 -> 1367    16.0 -> 36    (two lines in Canva: one `placeLine` here)
 *   RSVP TO COURTNEY   645.8 -> 1470    13.3 -> 30    -> hostContactLine
 *
 * ...then tuned by eye. In Canva the small Hello Kitty with balloons (x 888-1065,
 * y 1390-1520 here) sits on top of the end of the address line ("SUITE 7"). Every
 * slot below y 1360 is centred with a maxWidth of at most 660, so its right edge
 * stops at x 872, clear of her.
 *
 * Fonts: Canva's rounded display caps -> Fredoka 700 (white with a pink outline, as
 * the design's caps are drawn, and pink with a white outline for the age line); its
 * script name -> Dancing Script 700.
 *
 * Wording: "Hensley's" -> `honoreePossessive` ("our Birthday Star's" with no name).
 * "5th BIRTHDAY" -> row [ageOrdinal, "BIRTHDAY"] ("BIRTHDAY" alone with no age:
 * "Mia's / BIRTHDAY"). "iT'S A SPA PARTY!" says what the party IS, so it binds
 * the theme: row ["IT'S A", themeWord, "PARTY!"] ("IT'S A SLIME PARTY!",
 * "IT'S A BIRTHDAY PARTY!" unthemed). The design's lower-case "i" was a quirk of the
 * original and is not kept. The date block is [weekday "-" month day] and the time;
 * with no date it falls back to `dateLine` ("PICK YOUR DATE").
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const PINK = '#f27195'
const DEEP_PINK = '#e0557f'
const WHITE = '#ffffff'

const PINK_OUTLINE = { width: 3, color: DEEP_PINK }
const WHITE_OUTLINE = { width: 3, color: WHITE }

export const HELLO_KITTY_TEMPLATE: TemplateLayout = {
  slug: 'hello-kitty',
  label: 'Hello Kitty',
  source: { canvaDesignId: 'DAGt5bSmvao', canvaArtCopyId: 'DAHXvt6Vkyk' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/hello-kitty/background.webp', raster: '/evites/hello-kitty/background.jpg' },
  backgroundColor: '#ffbccf',
  layers: [],
  slots: [
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      top: 852,
      font: 'dancing700',
      size: 112,
      minSize: 52,
      // The pale band runs x 155-930.
      maxWidth: 700,
      lineHeight: 1.35,
      color: PINK,
    },
    {
      id: 'age_row',
      type: 'row',
      top: 1012,
      gap: 30,
      maxWidth: 900,
      align: 'baseline',
      boxHeight: 104,
      children: [
        { id: 'age', type: 'text', bind: 'ageOrdinal', top: 0, font: 'fredoka700', size: 74, lineHeight: 1.4, letterSpacingEm: 0.12, color: PINK, stroke: WHITE_OUTLINE, showWhen: 'ageOrdinal' },
        { id: 'birthday_word', type: 'text', staticText: 'BIRTHDAY', top: 0, font: 'fredoka700', size: 74, lineHeight: 1.4, letterSpacingEm: 0.26, color: PINK, stroke: WHITE_OUTLINE },
      ],
    },
    {
      id: 'theme_row',
      type: 'row',
      top: 1118,
      gap: 16,
      maxWidth: 880,
      align: 'baseline',
      boxHeight: 76,
      children: [
        { id: 'its_a', type: 'text', staticText: "IT'S A", top: 0, font: 'fredoka700', size: 54, lineHeight: 1.4, letterSpacingEm: 0.04, color: WHITE, stroke: PINK_OUTLINE },
        { id: 'theme_word', type: 'text', bind: 'themeWord', uppercase: true, top: 0, font: 'fredoka700', size: 54, lineHeight: 1.4, letterSpacingEm: 0.04, color: WHITE, stroke: PINK_OUTLINE },
        { id: 'party_word', type: 'text', staticText: 'PARTY!', top: 0, font: 'fredoka700', size: 54, lineHeight: 1.4, letterSpacingEm: 0.04, color: WHITE, stroke: PINK_OUTLINE },
      ],
    },
    {
      id: 'date_row',
      type: 'row',
      top: 1226,
      gap: 14,
      maxWidth: 860,
      align: 'baseline',
      boxHeight: 64,
      showWhen: 'dayText',
      children: [
        { id: 'weekday', type: 'text', bind: 'weekdayText', uppercase: true, top: 0, font: 'fredoka700', size: 46, lineHeight: 1.4, letterSpacingEm: 0.04, color: WHITE, stroke: PINK_OUTLINE },
        { id: 'date_dash', type: 'text', staticText: '-', top: 0, font: 'fredoka700', size: 46, lineHeight: 1.4, color: WHITE, stroke: PINK_OUTLINE },
        { id: 'month', type: 'text', bind: 'monthText', uppercase: true, top: 0, font: 'fredoka700', size: 46, lineHeight: 1.4, letterSpacingEm: 0.04, color: WHITE, stroke: PINK_OUTLINE },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'fredoka700', size: 46, lineHeight: 1.4, letterSpacingEm: 0.04, color: WHITE, stroke: PINK_OUTLINE },
      ],
    },
    {
      id: 'date_fallback',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 1226,
      font: 'fredoka700',
      size: 46,
      minSize: 28,
      maxWidth: 860,
      lineHeight: 1.4,
      letterSpacingEm: 0.04,
      color: WHITE,
      stroke: PINK_OUTLINE,
      showWhen: '!dayText',
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      uppercase: true,
      top: 1288,
      font: 'fredoka700',
      size: 46,
      minSize: 28,
      maxWidth: 660,
      lineHeight: 1.4,
      letterSpacingEm: 0.04,
      color: WHITE,
      stroke: PINK_OUTLINE,
      showWhen: 'timeText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      uppercase: true,
      top: 1368,
      font: 'fredoka700',
      size: 36,
      minSize: 22,
      // Right edge 872: clear of the mini Kitty and her balloons (x 888+).
      maxWidth: 660,
      lineHeight: 1.4,
      letterSpacingEm: 0.03,
      color: WHITE,
      // A hard shadow rather than an outline: shrunk to fit a long street address, an outline's
      // overlapping strokes turn to seams, and a shadow stays clean at any size.
      shadow: { x: 2, y: 3, color: DEEP_PINK },
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      uppercase: true,
      top: 1440,
      font: 'fredoka600',
      size: 30,
      minSize: 20,
      maxWidth: 640,
      lineHeight: 1.4,
      letterSpacingEm: 0.03,
      color: DEEP_PINK,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'dancing700',
    titleSize: 74,
    // Deeper than the invitation's pink and with no outline: a thin script with a white
    // outline read washed-out on the light card.
    titleColor: '#d94078',
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#ffe4ec', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: PINK,
    ctaColor: '#ffffff',
    titleUppercase: false,
    titleShadow: { x: 2, y: 2, color: '#ffffff' },
    textColor: '#5a2338',
    hostColor: DEEP_PINK,
    backdrop: 'linear-gradient(135deg, #ffd3df 0%, #fff2f6 55%, #ffc4d4 100%)',
    portraitShadow: '0 10px 30px #c2397f55',
  },
}
