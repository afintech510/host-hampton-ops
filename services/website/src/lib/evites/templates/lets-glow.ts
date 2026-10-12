/**
 * The Let's Glow template, from Adam's Canva design "Purple and Pink Neon Retro
 * Birthday Party Invitation" (DAGy3PupWvw, 480x672).
 *
 * The background is that design with every text element and the date divider
 * deleted (working copy DAHXvtcGXVI, exported 2186x3060, scaled to 1093x1530 and
 * cropped 4 px each side to the 1085x1530 canvas), so the retro grid, the four
 * neon sparkles, the two pink neon arcs and the purple polygon mesh are art.
 * Canva's geometry x 2.277 (element centre, then our own line box around it):
 *
 *   Let's Glow     75.1 / h 41    -> centre 218   34.8 -> 79
 *   Chiara's      132.3 / h 75    -> centre 387   63.9 -> 145
 *   5th           175.6 / h 152   -> centre 573  127.2 -> 290
 *   Birthday      283.4 / h 136   -> centre 800  115.2 -> 262
 *   November 8 | 1-3 PM   430.7   -> centre 1019  28.6 -> 65
 *   Host Hampton / 295 Montauk Highway Speonk   470.8 / h 46 -> 1072..1177
 *   RSVP to <mom> <phone>  550.2  -> 1252..1332  16.7 -> 38
 *
 * ...then tuned by eye against the Canva thumbnail, because Yellowtail sits
 * differently in its line box from Canva's neon script: the age and "Birthday"
 * were placed by their BASELINES as measured off the thumbnail (705 and 884),
 * the age then lifted 10 px so its foot clears the "B" of Birthday.
 *
 * Fonts: Canva's neon script -> Yellowtail (closest OFL retro script); the bold
 * name -> Montserrat 800; the details -> Poppins 600 / 400.
 *
 * Bound vs static: "Let's Glow" and "Birthday" are the design's slogan and stay
 * static. The name is `honoreePossessive` upper-cased ("MIA'S" / "OUR BIRTHDAY
 * STAR'S"); the age is `ageOrdinal`. With no age, a second "Birthday" slot sits
 * higher and larger so the card does not open a hole where "5th" was.
 *
 * The date row is Canva's "November 8 | 1-3 PM": month and day, a separator, the
 * time. The separator only shows with a time (`needs_time` reads "November 14"
 * alone), and a preview, whose pieces are all '', shows `dateLine` ("Pick your
 * date") instead. The separator is a "|" between two no-break spaces, because a
 * row's gap is one number and the separator wants more air than the space
 * between "November" and "14". Canva's two-line place block is one `placeLine`
 * here (studio: "Host Hampton · 295 Montauk Hwy, Speonk"). "RSVP to Samantha
 * <phone>" is `hostContactLine`: guests RSVP online, and the line names Allie.
 *
 * Changing anything here changes what a stored image should look like, so bump
 * `RENDER_LAYOUT_TAG` in hash.ts with it.
 */

import type { Glow, TemplateLayout } from '@/lib/evites/templates/types'

/** `0 0 r1 c, 0 0 r2 c, ...`: one colour at several radii, the neon-tube halo. */
function halo(color: string, radii: number[]): Glow {
  return { stops: radii.map((radius) => ({ color, radius })) }
}

const PINK = '#ff25ab'
const PINK_CORE = '#ffd3ef'
const CYAN = '#5ce1e6'
const NIGHT = '#170a3a'

export const LETS_GLOW_TEMPLATE: TemplateLayout = {
  slug: 'lets-glow',
  label: "Let's Glow (Retro Neon)",
  source: { canvaDesignId: 'DAGy3PupWvw', canvaArtCopyId: 'DAHXvtcGXVI' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/lets-glow/background.webp', raster: '/evites/lets-glow/background.jpg' },
  backgroundColor: '#0b0626',
  layers: [],
  slots: [
    {
      id: 'slogan',
      type: 'text',
      staticText: "Let's Glow",
      top: 164,
      font: 'yellowtail',
      size: 80,
      lineHeight: 1.35,
      color: '#c9fbfd',
      glow: halo(CYAN, [4, 12, 26]),
    },
    {
      id: 'honoree',
      type: 'text',
      bind: 'honoreePossessive',
      uppercase: true,
      top: 303,
      font: 'montserrat800',
      size: 140,
      minSize: 60,
      maxWidth: 900,
      lineHeight: 1.2,
      color: '#ffffff',
      glow: halo('#ff6fd8', [6, 18, 38]),
    },
    {
      id: 'age',
      type: 'text',
      bind: 'ageOrdinal',
      top: 402,
      font: 'yellowtail',
      size: 290,
      minSize: 160,
      maxWidth: 700,
      lineHeight: 1.35,
      color: PINK_CORE,
      glow: halo(PINK, [6, 18, 42]),
      showWhen: 'ageOrdinal',
    },
    {
      id: 'birthday_word',
      type: 'text',
      staticText: 'Birthday',
      top: 619,
      font: 'yellowtail',
      size: 262,
      lineHeight: 1.35,
      color: PINK_CORE,
      glow: halo(PINK, [6, 18, 42]),
      showWhen: 'ageOrdinal',
    },
    {
      // No age: "Birthday" alone, centred in the space the age and the word shared.
      id: 'birthday_word_no_age',
      type: 'text',
      staticText: 'Birthday',
      top: 540,
      font: 'yellowtail',
      size: 262,
      lineHeight: 1.35,
      color: PINK_CORE,
      glow: halo(PINK, [6, 18, 42]),
      showWhen: '!ageOrdinal',
    },
    {
      id: 'date_row',
      type: 'row',
      top: 975,
      gap: 18,
      maxWidth: 880,
      align: 'baseline',
      boxHeight: 93,
      showWhen: 'dayText',
      children: [
        { id: 'date_month', type: 'text', bind: 'monthText', top: 0, font: 'poppins600', size: 62, minSize: 30, lineHeight: 1.5, color: '#ffffff', glow: halo('#ff6fd8', [8]) },
        { id: 'date_day', type: 'text', bind: 'dayText', top: 0, font: 'poppins600', size: 62, minSize: 30, lineHeight: 1.5, color: '#ffffff', glow: halo('#ff6fd8', [8]) },
        { id: 'date_sep', type: 'text', staticText: ' | ', top: 0, font: 'poppins400', size: 62, minSize: 30, lineHeight: 1.5, color: 'rgba(255,255,255,0.75)', showWhen: 'timeText' },
        { id: 'date_time', type: 'text', bind: 'timeText', top: 0, font: 'poppins600', size: 62, minSize: 30, lineHeight: 1.5, color: '#ffffff', glow: halo('#ff6fd8', [8]), showWhen: 'timeText' },
      ],
    },
    {
      // A preview has no date pieces: "Pick your date" where the row would be.
      id: 'date_line',
      type: 'text',
      bind: 'dateLine',
      top: 975,
      font: 'poppins600',
      size: 62,
      minSize: 30,
      maxWidth: 880,
      lineHeight: 1.5,
      color: '#ffffff',
      glow: halo('#ff6fd8', [8]),
      showWhen: '!dayText',
    },
    {
      id: 'location',
      type: 'text',
      bind: 'placeLine',
      top: 1082,
      font: 'poppins600',
      size: 42,
      minSize: 22,
      maxWidth: 900,
      lineHeight: 1.5,
      color: '#ffffff',
      glow: halo(NIGHT, [6, 12]),
    },
    {
      id: 'host_contact',
      type: 'text',
      bind: 'hostContactLine',
      top: 1262,
      font: 'poppins400',
      size: 36,
      minSize: 20,
      maxWidth: 860,
      lineHeight: 1.5,
      color: '#ffffff',
      // The line sits on the purple mesh, as Canva's RSVP did: a dark halo keeps it readable.
      glow: halo(NIGHT, [4, 10, 18]),
      showWhen: 'hostContactLine',
    },
  ],
  ogCard: {
    portraitHeight: 560,
    radius: 14,
    titleFont: 'yellowtail',
    titleSize: 74,
    titleColor: PINK_CORE,
    glow: halo(PINK, [6, 18, 40]),
    ctaText: 'Tap to RSVP',
    ctaBg: PINK,
    ctaColor: '#ffffff',
    titleUppercase: false,
    portraitShadow: '0 10px 40px #ff25ab66',
  },
}
