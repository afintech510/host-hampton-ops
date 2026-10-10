/**
 * The Glow (neon) template (spec §6), transcribed from
 * `docs/specs/evites/handoff/templates/glow.layout.json` and tuned to what the P01
 * spike proved against `handoff/mocks/invite_mia.png` (0-2 px).
 *
 * Every number here is the spike's: the box tops, the sizes, the explicit
 * `lineHeight` (the design's CSS `normal` ratio per font: Poppins 1.5, Bungee
 * Outline 1.32, Neonderthaw 1.35; the two display lines are `1`), the glow stops.
 * The text-shadow glow is `0 0 6px c, 0 0 18px c, 0 0 40px c` (`tx()`); GLOW itself
 * is a gradient with `drop-shadow(#ff3df2 10px) drop-shadow(#8a3dff 26px)`.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { Glow, TemplateLayout } from '@/lib/evites/templates/types'

/** `0 0 6px c, 0 0 18px c, 0 0 40px c`, the layout's `glow_text_shadow`. */
function tx(color: string): Glow {
  return { stops: [6, 18, 40].map((radius) => ({ color, radius })) }
}

const CREAM = '#fbf9f1'

export const GLOW_TEMPLATE: TemplateLayout = {
  slug: 'glow',
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/glow/background.webp', raster: '/evites/glow/background.jpg' },
  backgroundColor: '#1b0630',
  layers: [
    {
      id: 'bar',
      type: 'shape',
      left: 170,
      top: 653,
      width: 745,
      height: 7,
      radius: '4px',
      fill: 'linear-gradient(90deg,#ff2bd6,#b45cff 55%,#3d8bff)',
      glow: {
        stops: [
          { color: '#ff2bd6', radius: 8 },
          { color: '#a24bff', radius: 22 },
          { color: '#5b6bff', radius: 40 },
        ],
      },
    },
    {
      id: 'bracket_left',
      type: 'shape',
      left: 135,
      top: 1285,
      width: 30,
      height: 148,
      radius: '32px 0 0 32px',
      border: { width: 5, color: '#ff3df2', sides: ['t', 'b', 'l'] },
      glow: {
        stops: [
          { color: '#ff3df2', radius: 10 },
          { color: '#c92bff', radius: 24 },
        ],
      },
    },
    {
      id: 'bracket_right',
      type: 'shape',
      left: 920,
      top: 1285,
      width: 30,
      height: 148,
      radius: '0 32px 32px 0',
      border: { width: 5, color: '#ff3df2', sides: ['t', 'b', 'r'] },
      glow: {
        stops: [
          { color: '#ff3df2', radius: 10 },
          { color: '#c92bff', radius: 24 },
        ],
      },
    },
    { id: 'squiggle_left', type: 'image', src: '/evites/glow/squiggle.png', left: 70, top: 430, height: 210, aspect: 292 / 480, rotateDeg: -40 },
    { id: 'squiggle_top_right', type: 'image', src: '/evites/glow/squiggle.png', left: 960, top: -10, height: 170, aspect: 292 / 480, rotateDeg: 10 },
  ],
  slots: [
    {
      id: 'invited_line',
      type: 'text',
      staticText: "You're invited to a",
      top: 118,
      font: 'poppins400',
      size: 30,
      lineHeight: 1.5,
      letterSpacingEm: 0.33,
      uppercase: true,
      // The mock's `opacity: .95`, folded into the colour so the slot needs no opacity field.
      color: 'rgba(251,249,241,0.95)',
    },
    {
      id: 'theme_word',
      type: 'text',
      bind: 'themeWord',
      top: 160,
      font: 'monoton',
      size: 250,
      minSize: 120,
      maxWidth: 1000,
      lineHeight: 1,
      fill: { gradient: ['#ff3df2', '#ffd23f 35%', '#3dd9ff 70%', '#b84dff'], angleDeg: 90 },
      glow: {
        stops: [
          { color: '#ff3df2', radius: 10 },
          { color: '#8a3dff', radius: 26 },
        ],
      },
    },
    {
      id: 'theme_sub',
      type: 'text',
      bind: 'themeSub',
      top: 470,
      font: 'bungee',
      size: 138,
      minSize: 70,
      maxWidth: 1000,
      lineHeight: 1,
      color: '#ff5a6e',
      glow: tx('#ff3355'),
    },
    { id: 'icon_strip', type: 'image', src: '/evites/glow/icon-strip.png', top: 700, width: 820, aspect: 1640 / 234 },
    {
      id: 'honoree_row',
      type: 'row',
      top: 835,
      gap: 24,
      maxWidth: 960,
      align: 'center',
      // The nominal box of the name at full size. A shrunken name is centred in it (spec changelog B5).
      boxHeight: 165,
      children: [
        {
          id: 'honoree',
          type: 'text',
          bind: 'honoreeDisplay',
          top: 0,
          font: 'bungee',
          size: 165,
          minSize: 90,
          lineHeight: 1,
          uppercase: true,
          color: '#fff028',
          glow: tx('#ffe100'),
        },
        { id: 'star', type: 'image', src: '/evites/glow/star.png', top: 0, width: 156, aspect: 252 / 240, showWhen: '!hasName' },
      ],
    },
    {
      id: 'age_row',
      type: 'row',
      top: 1035,
      gap: 22,
      maxWidth: 1000,
      align: 'baseline',
      showWhen: 'ageOrdinal',
      children: [
        { id: 'age', type: 'text', bind: 'ageOrdinal', top: 0, font: 'bungee', size: 128, minSize: 60, lineHeight: 1.32, uppercase: true, color: '#ffffff', glow: tx('#c77dff') },
        { id: 'birthday_word', type: 'text', staticText: 'Birthday!', top: 0, font: 'neon', size: 132, minSize: 60, lineHeight: 1.35, color: '#ffffff', glow: tx('#ff4fd8') },
      ],
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'dateLine',
      top: 1292,
      font: 'poppins600',
      size: 36,
      minSize: 20,
      maxWidth: 760,
      lineHeight: 1.5,
      letterSpacingEm: 0.04,
      uppercase: true,
      color: CREAM,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1345,
      font: 'poppins400',
      size: 25,
      minSize: 16,
      maxWidth: 760,
      lineHeight: 1.5,
      letterSpacingEm: 0.06,
      color: CREAM,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1388,
      font: 'poppins400',
      size: 25,
      minSize: 16,
      maxWidth: 760,
      lineHeight: 1.5,
      letterSpacingEm: 0.06,
      color: '#ffd6f6',
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'bungee',
    titleSize: 74,
    titleColor: '#fff028',
    glow: tx('#ffe100'),
    ctaText: 'Tap to RSVP',
    ctaBg: '#ff3df2',
    ctaColor: '#1b0630',
  },
}
