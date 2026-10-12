/**
 * The Pastel Slime template, from Adam's Canva design "Neon Colorful Fun Slime
 * Kids Birthday Party Invitation" (DAGRDELb3hs, 480x672).
 *
 * The background is that design with every text element and the Host Hampton
 * wordmark + address group deleted (working copy DAHXvlyqEiQ, exported 2186x3060,
 * scaled to 1093x1530 and cropped 4 px each side to the 1085x1530 canvas). So a
 * Canva top x 2.277 is our `top`, a Canva font size x 2.277 is our size:
 *
 *   YOU'RE INVITED TO COOPER'S   150.5 -> 343    14.7 -> 33   (a sans in capitals, tracked 0.037)
 *   SLIME / PARTY                147.2 -> 335   107.9 -> 246  (one two-line box, line-height 0.87;
 *                                                               measured off the thumbnail the caps
 *                                                               are at 415-589 and 621-797)
 *   wordmark + 295 Montauk Hwy   359-452 -> 817-1029            (deleted: a venue logo is wrong for an
 *                                                               at-home party; `placeLine` replaces it)
 *   date / RSVP / phone          478 / 506 / 533 -> 1089 / 1152 / 1214
 *
 * ...then tuned by eye in the preview harness, because Fredoka is not Canva's
 * face. Canva's rounded display face is approximated by Fredoka 700 in the
 * design's lime; its small capitals sans by Montserrat 500.
 *
 * Bound: "SLIME" / "PARTY" are `themeWord` / `themeSub` (a parent may pick this art
 * for another theme); "COOPER'S" is `honoreePossessive` in capitals, after the
 * static "YOU'RE INVITED TO" in the same row. The date, the place and the RSVP line
 * ("RSVP to Sarah ... +123-456-7890" -> `hostContactLine`) are their facts. The
 * wordmark's slot holds `placeLine`, so the stack is place / date / contact, as the
 * Canva stack was venue / date / RSVP.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const LIME = '#aaf846'
const INK = '#1d1626'
const PINK_BG = '#fed4ff'

export const SLIME_PASTEL_TEMPLATE: TemplateLayout = {
  slug: 'slime-pastel',
  label: 'Pastel Slime',
  source: { canvaDesignId: 'DAGRDELb3hs', canvaArtCopyId: 'DAHXvlyqEiQ' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/slime-pastel/background.webp', raster: '/evites/slime-pastel/background.jpg' },
  backgroundColor: PINK_BG,
  layers: [],
  slots: [
    {
      id: 'invited_row',
      type: 'row',
      top: 343,
      gap: 11,
      maxWidth: 940,
      align: 'baseline',
      boxHeight: 46,
      children: [
        {
          id: 'invited_line',
          type: 'text',
          staticText: "You're invited to",
          uppercase: true,
          top: 0,
          font: 'montserrat500',
          size: 33,
          lineHeight: 1.4,
          letterSpacingEm: 0.037,
          color: INK,
        },
        {
          id: 'honoree',
          type: 'text',
          bind: 'honoreePossessive',
          uppercase: true,
          top: 0,
          font: 'montserrat500',
          size: 33,
          lineHeight: 1.4,
          letterSpacingEm: 0.037,
          color: INK,
        },
      ],
    },
    {
      id: 'theme_word',
      type: 'text',
      bind: 'themeWord',
      uppercase: true,
      top: 373,
      font: 'fredoka700',
      size: 246,
      minSize: 120,
      maxWidth: 960,
      lineHeight: 1,
      color: LIME,
    },
    {
      id: 'theme_sub',
      type: 'text',
      bind: 'themeSub',
      uppercase: true,
      top: 579,
      font: 'fredoka700',
      size: 246,
      minSize: 120,
      maxWidth: 960,
      lineHeight: 1,
      color: LIME,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      uppercase: true,
      top: 905,
      font: 'montserrat500',
      size: 33,
      minSize: 20,
      maxWidth: 990,
      lineHeight: 1.4,
      letterSpacingEm: 0.037,
      color: INK,
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 1010,
      font: 'montserrat500',
      size: 33,
      minSize: 20,
      maxWidth: 860,
      lineHeight: 1.4,
      letterSpacingEm: 0.037,
      color: INK,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      uppercase: true,
      top: 1070,
      font: 'montserrat500',
      size: 33,
      minSize: 20,
      maxWidth: 860,
      lineHeight: 1.4,
      letterSpacingEm: 0.037,
      color: INK,
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'fredoka700',
    titleSize: 74,
    titleColor: LIME,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#fff0ff', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: '#7cc425',
    ctaColor: '#ffffff',
    titleStroke: { width: 2, color: INK },
    titleShadow: { x: 3, y: 3, color: INK },
    textColor: '#3a2340',
    hostColor: '#5c3a66',
    backdrop: 'linear-gradient(135deg, #fed4ff 0%, #fff0ff 55%, #e9fbd4 100%)',
    portraitShadow: '0 10px 30px #8a3a8a55',
  },
}
