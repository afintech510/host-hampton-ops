/**
 * The Watercolor Unicorn template, from page 1 of Adam's Canva design
 * "Watercolor colorful magical unicorn birthday kids party invitation"
 * (DAGpYwh8SGE, 480x672, two pages; page 2 is not used): a rainbow, a unicorn
 * head and lavender clouds, all purple lettering.
 *
 * The art is the page's own background image; every text element was deleted
 * (working copy DAHXvrfOo3k, exported 2186x3060, scaled to 1093x1530 and cropped
 * 4 px each side). A Canva top x 2.277 is our top; a size x 2.277 is ours:
 *
 *   YOU ARE INVITED TO     15.5 -> 35     17.2 -> 39   (sans caps, +6% tracking)
 *   Annabel's              48.0 -> 109   110.1 -> 251  (script, over the rainbow)
 *   Birthday              405.9 -> 924   116.8 -> 266  (script, centre x 587)
 *   PARTY                 518.3 -> 1180   33.3 -> 76   (bold serif)
 *   June 21 | 10am-12pm   566.4 -> 1290   17.2 -> 39   (sans caps)
 *   Host hampton / 295 .. 595.8 -> 1357   17.2 -> 39   (two lines; ours is one)
 *   RSVP to Jennifer ..   645.7 -> 1470   17.2 -> 39
 *
 * ...then tuned by eye: Great Vibes is smaller on its body than Canva's script, so
 * the name and "Birthday" are set larger, and the three detail lines are spread a
 * little because each is one line here rather than Canva's two-line place block.
 *
 * Fonts: Great Vibes (Canva's thin flowing script has no open equivalent closer),
 * Playfair Display 700 for PARTY, Montserrat 500 for the tracked caps.
 *
 * Wording: "Birthday" / "PARTY" stay static - this design IS a birthday-party card,
 * and binding `themeWord` here would print "Slime Party" over a unicorn. The date
 * line is `dateLine` in capitals ("SATURDAY, NOVEMBER 14 . 2-4 PM"), which also
 * reads correctly as "PICK YOUR DATE" in a preview. "RSVP to Jennifer ..." becomes
 * the host contact line.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const PURPLE = '#632486'

export const UNICORN_TEMPLATE: TemplateLayout = {
  slug: 'unicorn',
  label: 'Watercolor Unicorn',
  source: { canvaDesignId: 'DAGpYwh8SGE', canvaArtCopyId: 'DAHXvrfOo3k' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/unicorn/background.webp', raster: '/evites/unicorn/background.jpg' },
  backgroundColor: '#ffffff',
  layers: [],
  slots: [
    {
      id: 'invited_line',
      type: 'text',
      staticText: 'YOU ARE INVITED TO',
      top: 30,
      font: 'montserrat500',
      size: 39,
      lineHeight: 1.24,
      letterSpacingEm: 0.062,
      color: PURPLE,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      top: 80,
      font: 'greatvibes',
      size: 260,
      minSize: 110,
      maxWidth: 960,
      lineHeight: 1.3,
      color: PURPLE,
    },
    {
      id: 'birthday_word',
      type: 'text',
      staticText: 'Birthday',
      top: 890,
      box: { left: 90, width: 995, align: 'center' },
      font: 'greatvibes',
      size: 280,
      lineHeight: 1.3,
      color: PURPLE,
    },
    {
      id: 'party_word',
      type: 'text',
      staticText: 'PARTY',
      top: 1172,
      font: 'playfair700',
      size: 78,
      lineHeight: 1.3,
      letterSpacingEm: 0.02,
      color: PURPLE,
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 1292,
      font: 'montserrat500',
      size: 39,
      minSize: 26,
      maxWidth: 960,
      lineHeight: 1.3,
      letterSpacingEm: 0.062,
      color: PURPLE,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      uppercase: true,
      top: 1366,
      font: 'montserrat500',
      size: 36,
      minSize: 24,
      maxWidth: 960,
      lineHeight: 1.3,
      letterSpacingEm: 0.062,
      color: PURPLE,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      showWhen: 'hostContactLine',
      uppercase: true,
      top: 1440,
      font: 'montserrat500',
      size: 34,
      minSize: 24,
      maxWidth: 960,
      lineHeight: 1.3,
      letterSpacingEm: 0.062,
      color: PURPLE,
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'greatvibes',
    titleSize: 74,
    titleColor: PURPLE,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#efe4ff', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: '#8a4fb8',
    ctaColor: '#ffffff',
    titleUppercase: false,
    textColor: '#3d2350',
    hostColor: '#7a4aa0',
    backdrop: 'linear-gradient(135deg, #fde6ef 0%, #f3ecff 50%, #e3eeff 100%)',
    portraitShadow: '0 10px 30px #6a3a8a44',
  },
}
