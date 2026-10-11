/**
 * The Pastel Slime (Teal) template, from Adam's Canva design "Neon Colorful Fun
 * Slime Kids Birthday Party Invitation.pdf" (DAGRDcrRwzY, 480x672): the Pastel
 * Slime art with a teal title set staggered and the details in two columns.
 *
 * The background is that design with every text element and the Host Hampton
 * wordmark + address group deleted (working copy DAHXvkTsspg, exported 2186x3060,
 * scaled to 1093x1530 and cropped 4 px each side). x = Canva x x 2.277 - 4,
 * top = Canva top x 2.277, size = Canva size x 2.277:
 *
 *   SLIME   box x 25.7-298 -> 54-675 (centre 365), caps at 435-601, 107.1 -> 244
 *   PARTY   box x 167-432 -> 377-980 (centre 678), caps at 644-801, 107.9 -> 246
 *   details (left column, x 34-318 -> 73-720): date / RSVP / phone, line centres 910 / 974 / 1035
 *   YOU'RE INVITED TO / SADIE & HANNAH's   bottom-left, 474-519 -> 1080-1182, 19.1 -> 44
 *   wordmark + address   bottom-right, x 288-476 -> 652-1080, 420-513 -> 957-1168 (deleted)
 *
 * What changed, so this is a different choice from Pastel Slime and not a copy:
 * the details are a FLUSH-LEFT column (date / place / contact, where the Canva's
 * date / RSVP / phone were), and the invitation line with the child's name is a
 * FLUSH-RIGHT block at the bottom, in the slot the bold-serif HAMPTON wordmark
 * held, set the same way: a light serif kicker over a bold serif name. A wordmark
 * column cannot hold `placeLine` (one line, up to ~50 characters for an at-home
 * address: it would be ~16 px in a 400 px column), so the place joined the
 * details. The bottom-left glass blob reaches x 126 from y 1059, so the left
 * column ends above it.
 *
 * Fonts: Fredoka 700 for Canva's rounded display face, Montserrat 500 capitals for
 * its small sans, Playfair Display for its serif.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { TemplateLayout } from '@/lib/evites/templates/types'

const TEAL = '#6cc0bf'
const INK = '#1d1626'

const LEFT_COL = { left: 80, width: 920, align: 'left' as const }
const RIGHT_BLOCK = { left: 215, width: 800, align: 'right' as const }

export const SLIME_TEAL_TEMPLATE: TemplateLayout = {
  slug: 'slime-teal',
  label: 'Pastel Slime (Teal)',
  source: { canvaDesignId: 'DAGRDcrRwzY', canvaArtCopyId: 'DAHXvkTsspg' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/slime-teal/background.webp', raster: '/evites/slime-teal/background.jpg' },
  backgroundColor: '#fed4ff',
  layers: [],
  slots: [
    {
      id: 'theme_word',
      type: 'text',
      bind: 'themeWord',
      uppercase: true,
      top: 394,
      box: { left: 30, width: 650, align: 'center' },
      font: 'fredoka700',
      size: 244,
      minSize: 110,
      maxWidth: 650,
      lineHeight: 1,
      color: TEAL,
    },
    {
      id: 'theme_sub',
      type: 'text',
      bind: 'themeSub',
      uppercase: true,
      top: 603,
      box: { left: 355, width: 690, align: 'center' },
      font: 'fredoka700',
      size: 246,
      minSize: 110,
      maxWidth: 690,
      lineHeight: 1,
      color: TEAL,
    },
    {
      id: 'date_time',
      type: 'text',
      bind: 'dateLine',
      uppercase: true,
      top: 887,
      box: LEFT_COL,
      font: 'montserrat500',
      size: 33,
      minSize: 20,
      maxWidth: 920,
      lineHeight: 1.4,
      letterSpacingEm: 0.037,
      color: INK,
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      uppercase: true,
      top: 945,
      box: LEFT_COL,
      font: 'montserrat500',
      size: 33,
      minSize: 20,
      maxWidth: 920,
      lineHeight: 1.4,
      letterSpacingEm: 0.037,
      color: INK,
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      uppercase: true,
      top: 1003,
      box: LEFT_COL,
      font: 'montserrat500',
      size: 33,
      minSize: 20,
      maxWidth: 920,
      lineHeight: 1.4,
      letterSpacingEm: 0.037,
      color: INK,
      showWhen: 'hostContactLine',
    },
    {
      id: 'invited_line',
      type: 'text',
      staticText: "You're invited to",
      uppercase: true,
      top: 1080,
      box: RIGHT_BLOCK,
      font: 'playfair400',
      size: 44,
      lineHeight: 1.2,
      letterSpacingEm: 0.037,
      color: INK,
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      uppercase: true,
      top: 1128,
      box: RIGHT_BLOCK,
      font: 'playfair700',
      size: 66,
      minSize: 36,
      maxWidth: 800,
      lineHeight: 1.2,
      color: INK,
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'fredoka700',
    titleSize: 74,
    titleColor: TEAL,
    glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#fff0ff', radius: 14 }] },
    ctaText: 'Tap to RSVP',
    ctaBg: '#3f9e9d',
    ctaColor: '#ffffff',
    titleStroke: { width: 2, color: INK },
    titleShadow: { x: 3, y: 3, color: INK },
    textColor: '#2a3340',
    hostColor: '#2f7d7c',
    backdrop: 'linear-gradient(135deg, #fed4ff 0%, #fff0ff 55%, #d7f3f2 100%)',
    portraitShadow: '0 10px 30px #3a6a8a55',
  },
}
