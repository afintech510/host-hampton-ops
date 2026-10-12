/**
 * The Neon Party template, from Adam's Canva design "Purple And Fuchsia Vibrant
 * Glowing Neon Birthday party Virtual Invitation" (DAG6mFHb8YI, 1240x1748).
 *
 * The background is that design with every text element AND the four pink rules
 * of the date row deleted (they were separate line elements; working copy
 * DAHXvqcHYcM, exported 2480x3496 and scaled to 1085x1530). The page is 1240 wide,
 * so the scale is 1085 / 1240 = 0.875 (vertically 1530 / 1748 = 0.8753):
 *
 *   let's party            370.6 -> 324     52.9 -> 46
 *   Cora's (script)        402.3 -> 352    311.7 -> 273   pink neon
 *   BIRTHDAY PARTY         775.9 -> 679    107.5 -> 94    bold capitals, pink neon
 *   rules                  y 992 / 1105 -> 868 / 967; x 151-461 -> 132-403 and 779-1056 -> 682-924
 *   Tursday | MAY 7 | 7:30 to 8:30   ~1000 -> ~875; 62.8 / 76.0 / 87.9 / 55.9 -> 55 / 66 / 77 / 49
 *   7 host hamton in speonk  1149.6 -> 1006  66.5 -> 58
 *   Rsvp 631-599-2469      1246.4 -> 1091    47.2 -> 41
 *
 * What changed, and why:
 *   - The rules are redrawn as `layers` shapes (glowing pink bars) at Canva's
 *     places, but shorter and further out so the middle (`monthText` + `dayText`, e.g.
 *     "NOVEMBER 14") has room: left 80-310, right 775-1005, middle 330-755; the
 *     weekday and time drop from 55 to 48 to fit their frames.
 *   - "Cora's" is `honoreePossessive` in Yellowtail with a pink neon glow (Canva's
 *     script face is not ours to bundle); "BIRTHDAY PARTY" is a row of `themeWord`
 *     + `themeSub` in Montserrat 800, so a Slime party reads "SLIME PARTY".
 *   - Canva's "MAY" with a raised "7" becomes the month and day on one baseline
 *     (the renderer has no superscript). The weekday and time sit in the left and
 *     right frames. With no date yet, `dateLine` ("Pick your date") fills the row.
 *   - "7 host hamton in speonk" (sic) is `placeLine`; the RSVP phone line is
 *     `hostContactLine` (guests RSVP online; the original's number was the Venmo line).
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { Glow, TemplateLayout } from '@/lib/evites/templates/types'

const FUCHSIA = '#f10ae0'
const WHITE = '#ffffff'
const NEON_WHITE = '#fff2fd'

/** Canva's pink neon: a white-hot core and a fuchsia halo. */
const NEON: Glow = { stops: [{ color: '#ff6df0', radius: 6 }, { color: FUCHSIA, radius: 18 }, { color: '#b000b8', radius: 38 }] }
const SOFT: Glow = { stops: [{ color: '#ff6df0', radius: 4 }, { color: FUCHSIA, radius: 12 }] }
const RULE_GLOW: Glow = { stops: [{ color: FUCHSIA, radius: 8 }, { color: '#b000b8', radius: 18 }] }

const rule = (id: string, left: number, top: number, width: number) =>
  ({ id, type: 'shape' as const, left, top, width, height: 8, radius: '4px', fill: FUCHSIA, glow: RULE_GLOW })

export const NEON_PARTY_TEMPLATE: TemplateLayout = {
  slug: 'neon-party',
  label: 'Neon Party',
  source: { canvaDesignId: 'DAG6mFHb8YI', canvaArtCopyId: 'DAHXvqcHYcM' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/neon-party/background.webp', raster: '/evites/neon-party/background.jpg' },
  backgroundColor: '#1d1040',
  layers: [
    rule('rule_left_top', 80, 864, 230),
    rule('rule_left_bottom', 80, 964, 230),
    rule('rule_right_top', 775, 864, 230),
    rule('rule_right_bottom', 775, 964, 230),
  ],
  slots: [
    {
      id: 'kicker',
      type: 'text',
      staticText: 'let’s party',
      top: 324,
      font: 'poppins400',
      size: 46,
      lineHeight: 1.4,
      color: WHITE,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      top: 382,
      font: 'yellowtail',
      size: 273,
      minSize: 110,
      maxWidth: 940,
      lineHeight: 1.15,
      color: NEON_WHITE,
      glow: NEON,
    },
    {
      id: 'theme_row',
      type: 'row',
      top: 697,
      gap: 28,
      maxWidth: 960,
      align: 'baseline',
      boxHeight: 113,
      children: [
        { id: 'theme_word', type: 'text', bind: 'themeWord', uppercase: true, top: 0, font: 'montserrat800', size: 94, lineHeight: 1.2, color: NEON_WHITE, glow: NEON },
        { id: 'theme_sub', type: 'text', bind: 'themeSub', uppercase: true, top: 0, font: 'montserrat800', size: 94, lineHeight: 1.2, color: NEON_WHITE, glow: NEON },
      ],
    },
    // ---- the date row, between the rules (band 872-964)
    {
      id: 'weekday',
      type: 'text',
      bind: 'weekdayText',
      top: 889,
      box: { left: 60, width: 270, align: 'center' },
      font: 'poppins400',
      size: 48,
      minSize: 34,
      maxWidth: 255,
      lineHeight: 1.2,
      color: WHITE,
      glow: SOFT,
    },
    {
      id: 'date_row',
      type: 'row',
      top: 870,
      box: { left: 330, width: 425, align: 'center' },
      gap: 12,
      maxWidth: 415,
      align: 'baseline',
      boxHeight: 94,
      showWhen: 'dayText',
      children: [
        { id: 'month', type: 'text', bind: 'monthText', uppercase: true, top: 0, font: 'montserrat800', size: 54, lineHeight: 1.1, color: WHITE, glow: SOFT },
        { id: 'day', type: 'text', bind: 'dayText', top: 0, font: 'montserrat800', size: 64, lineHeight: 1.1, color: WHITE, glow: SOFT },
      ],
    },
    {
      id: 'no_date',
      type: 'text',
      bind: 'dateLine',
      showWhen: '!dayText',
      top: 889,
      font: 'poppins400',
      size: 50,
      minSize: 36,
      maxWidth: 560,
      lineHeight: 1.2,
      color: WHITE,
      glow: SOFT,
    },
    {
      id: 'time',
      type: 'text',
      bind: 'timeText',
      showWhen: 'timeText',
      top: 889,
      box: { left: 755, width: 270, align: 'center' },
      font: 'poppins400',
      size: 48,
      minSize: 30,
      maxWidth: 255,
      lineHeight: 1.2,
      color: WHITE,
      glow: SOFT,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1006,
      font: 'poppins400',
      size: 50,
      minSize: 28,
      maxWidth: 920,
      lineHeight: 1.4,
      color: WHITE,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      showWhen: 'hostContactLine',
      top: 1091,
      font: 'poppins400',
      size: 38,
      minSize: 24,
      maxWidth: 860,
      lineHeight: 1.4,
      color: WHITE,
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'yellowtail',
    titleSize: 74,
    titleColor: NEON_WHITE,
    glow: SOFT,
    ctaText: 'Tap to RSVP',
    ctaBg: FUCHSIA,
    ctaColor: '#ffffff',
    titleUppercase: false,
  },
}
