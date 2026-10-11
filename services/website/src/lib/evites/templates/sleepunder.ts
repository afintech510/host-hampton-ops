/**
 * The Sleep Under template, from Adam's Canva design "Pastel Pink and Blue
 * Slumber Party Birthday Invitation" (DAHG2kUCXmE, 480x672).
 *
 * The background is that design with every text element and the date divider
 * deleted (working copy DAHXvDFCyIg, exported 2186x3060, scaled to 1093x1530 and
 * cropped 4 px each side to the 1085x1530 canvas). So every `top` below is the
 * Canva element's own top x 2.277, and every size is its font size x 2.277:
 *
 *   join us for a     106.7 -> 243    17.3 -> 40
 *   Sleepunder        122.7 -> 279    88.1 -> 200   (ours has a space, so it may shrink)
 *   Party             198.4 -> 452    82.7 -> 188
 *   to celebrate      274.3 -> 625    17.3 -> 40
 *   Eleanor's  12th   302.9 -> 690    64.8 -> 148 / 82.4 -> 188 (the ordinal is one slot here: 170)
 *   birthday          371.6 -> 846    48.7 -> 111
 *   date block        437.8 -> 997    stacked and centred rather than Canva's two columns,
 *                                     because a date line is one string ("Saturday, November 14 . 2-4 PM")
 *
 * ...then moved where Lobster needed it. Its descenders are much longer than
 * Canva's face: the "y" of Party (188 px at 452) ran through "to celebrate", and
 * lifting Party to clear it put the "p" of Sleep into its "P". So the title starts
 * higher (262), Party is 172 at 445, and the rest moves down to make room
 * (celebrate 680, name row 735, birthday 888 at 105, date block 1030 / 1082 / 1122).
 * The name row has a `boxHeight`, so a long name that shrinks stays centred where
 * "Mia's 7th" is.
 *
 * Canva's script face is not licensable for a server render; Lobster (OFL) is the
 * closest open one with clean outlines (Pacifico and Leckerli One overlap their
 * own strokes, which `-webkit-text-stroke` then draws as seams). Canva's sans is
 * Poppins here.
 *
 * Wording with no name is "our Birthday Star's" (`honoreePossessive`): the Glow
 * card's star icon is neon art and does not belong on this one.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const PINK = '#ff46a0'
const BLUE = '#9ed1da'
const INK = '#2b1a3a'
const DEEP_PINK = '#c2397f'

const OUTLINE = { width: 4, color: INK }
const DROP = { x: 6, y: 6, color: INK }

export const SLEEPUNDER_TEMPLATE: TemplateLayout = {
  slug: 'sleepunder',
  label: 'Sleep Under',
  source: { canvaDesignId: 'DAHG2kUCXmE', canvaArtCopyId: 'DAHXvDFCyIg' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/sleepunder/background.webp', raster: '/evites/sleepunder/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'invited_line',
      type: 'text',
      staticText: 'join us for a',
      top: 243,
      font: 'poppins400',
      size: 40,
      lineHeight: 1.4,
      color: PINK,
    },
    {
      id: 'theme_word',
      type: 'text',
      bind: 'themeWord',
      titleCase: true,
      top: 262,
      font: 'lobster',
      size: 200,
      minSize: 110,
      maxWidth: 980,
      lineHeight: 1.4,
      color: PINK,
      stroke: OUTLINE,
      shadow: DROP,
    },
    {
      id: 'theme_sub',
      type: 'text',
      bind: 'themeSub',
      titleCase: true,
      top: 445,
      font: 'lobster',
      size: 172,
      minSize: 100,
      maxWidth: 560,
      lineHeight: 1.4,
      color: PINK,
      stroke: OUTLINE,
      shadow: DROP,
    },
    {
      id: 'celebrate_line',
      type: 'text',
      staticText: 'to celebrate',
      top: 680,
      font: 'poppins400',
      size: 40,
      lineHeight: 1.4,
      color: PINK,
    },
    {
      id: 'honoree_row',
      type: 'row',
      top: 735,
      gap: 22,
      maxWidth: 980,
      align: 'baseline',
      // The age's nominal line box (170 x 1.4): the row is centred in it at whatever size it fits.
      boxHeight: 238,
      children: [
        {
          id: 'honoree',
          type: 'text',
          bind: 'honoreePossessive',
          top: 0,
          font: 'lobster',
          size: 148,
          minSize: 70,
          lineHeight: 1.4,
          color: BLUE,
          stroke: OUTLINE,
          shadow: DROP,
        },
        {
          id: 'age',
          type: 'text',
          bind: 'ageOrdinal',
          top: 0,
          font: 'lobster',
          size: 170,
          minSize: 80,
          lineHeight: 1.4,
          color: PINK,
          stroke: OUTLINE,
          shadow: DROP,
          showWhen: 'ageOrdinal',
        },
      ],
    },
    {
      id: 'birthday_word',
      type: 'text',
      staticText: 'birthday',
      top: 888,
      font: 'lobster',
      size: 105,
      lineHeight: 1.4,
      color: PINK,
      stroke: { width: 3, color: INK },
      shadow: { x: 4, y: 4, color: INK },
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'dateLine',
      top: 1030,
      font: 'poppins600',
      size: 36,
      minSize: 20,
      maxWidth: 680,
      lineHeight: 1.5,
      letterSpacingEm: 0.02,
      color: PINK,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1082,
      font: 'poppins400',
      size: 27,
      minSize: 16,
      maxWidth: 640,
      lineHeight: 1.5,
      color: DEEP_PINK,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1122,
      font: 'poppins400',
      size: 25,
      minSize: 16,
      maxWidth: 600,
      lineHeight: 1.5,
      color: DEEP_PINK,
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
    titleStroke: { width: 2, color: INK },
    titleShadow: { x: 3, y: 3, color: INK },
    textColor: '#4a2340',
    hostColor: DEEP_PINK,
    backdrop: 'linear-gradient(135deg, #ffe3ef 0%, #fff4f8 55%, #dff1f4 100%)',
    portraitShadow: '0 10px 30px #8a3a6a55',
  },
}
