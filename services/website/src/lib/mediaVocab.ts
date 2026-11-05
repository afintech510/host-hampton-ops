/**
 * The photo library's tag vocabulary, and the map from Muse's spelling to ours.
 *
 * `find_photos` filters by EXACT tag (`activities @> {tag}`, `theme_slug = tag`),
 * so a photo tagged `slime` is invisible to a search for `slime-making`, and
 * `kpop-demon-hunter-party` is invisible to the `kpop-party` theme page. Muse
 * tags from a list it was given, which mostly matches the catalogue, but the
 * list drifts between batches. Every tag therefore passes through `canonical*`
 * on the way in, and a tag we do not recognise is KEPT (it is real data) and
 * reported, never silently dropped or guessed at.
 *
 * Canonical themes are the `party_themes.slug` values (the public theme pages)
 * plus the two catalogue themes that have no theme page yet. Canonical
 * activities are the catalogue's `pricing_items` names, slugified.
 */

/** Theme slugs. `party_themes` rows, then catalogue themes without a page, then the catch-all. */
export const THEME_TAGS = [
  'glow-party', 'swiftie-party', 'spa-party', 'slime-party', 'kpop-party', 'barbie-party', 'sweets-treats',
  'sleep-under-party', 'toddler-party',
  'trucker-hat-party', 'race-car-party', 'unicorn-party',
  'custom',
] as const

/** Activity tags, each with the catalogue item(s) it stands for. */
export const ACTIVITY_TAGS: Record<string, string> = {
  'trucker-hat-bar': 'Trucker Hat Bar',
  'balloon-dog-painting': 'Drip Paint Balloon Dogs',
  'character-visit': 'Character Visit',
  'photo-booth': 'Photo Booth',
  'canvas-painting': 'Canvas Painting',
  'permanent-jewelry': 'Permanent Jewelry Mommy & Me',
  'perfume-making': 'Perfume Making',
  'bracelet-making': 'Bracelet Making / Make Your Own Bracelets',
  'sand-art': 'Sand Art',
  'cake-decorating': 'Fake Cake Decorating',
  'glitter-tattoos': 'Glitter Tattoos',
  'soft-play': 'Soft Play Setup',
  'hair-tinsel': 'Hair Tinsel / Beaded Braids',
  'lip-gloss-charms': 'Lip-Gloss Charms',
  slime: 'Slime / Make Your Own Slime',
  decoden: 'Decoden Crafts',
  manicure: 'Manicure / Manicures',
  'glam-makeup': 'Glam Makeup / Glam Station',
  'donut-decorating': 'Donut Decorating',
  'nail-polish': 'Make Your Own Nail Polish',
  scrapbooking: 'Scrapbooking',
  'tote-decorating': 'Custom Mini Canvas Tote / Jelly Tote / Canvas Bag Bar',
  'sunglasses-craft': 'DIY Sunglasses / Sunglass Craft',
  karaoke: 'Kiddie Karaoke / Decorate-Your-Own Microphone',
  'fashion-show': 'Fashion Show (Barbie)',
  'unicorn-craft': 'Unicorn Craft',
  'seashell-decorating': 'Seashell Decorating',
  'face-painting': 'Face Painter',
  'glitter-freckles': 'Glitter Freckles',
  'hair-brush-decorating': 'Hair Brush Decorating',
  'pirate-sword-decorating': 'Pirate Sword Decorating',
}

/** Decor tags, for the grid only (find_photos does not filter on them). */
export const DECOR_TAGS: Record<string, string> = {
  'table-setup': 'Room Setup & Décor',
  'balloon-garland': 'Balloon Garland 6 ft.',
  'balloon-tower': 'Balloon Tower 6 ft.',
  'balloon-arch': 'Double Arch Backdrop & Balloon Arches',
  backdrop: 'Double Arch Backdrop & Balloon Arches',
  'treat-table': 'Custom Treat Table',
  'candy-wall': 'Candy Wall',
  cake: 'Sheet Cake / Half Sheet Cake',
  tents: 'Sleep Under Party',
  'glow-lights': 'Glow Party',
  'neon-sign': 'Glow Party',
}

/** Muse (or a human) wrote this; we say that. Keys are already lowercased and hyphenated. */
const THEME_ALIASES: Record<string, string> = {
  'kpop-demon-hunter-party': 'kpop-party', 'k-pop-party': 'kpop-party', 'k-pop-demon-hunter-party': 'kpop-party', 'kpop': 'kpop-party',
  'sweets-n-treats-party': 'sweets-treats', 'sweets-and-treats': 'sweets-treats', 'sweets-treats-party': 'sweets-treats',
  'trucker-hat': 'trucker-hat-party', 'trucker-hat-bar-party': 'trucker-hat-party',
  'glow': 'glow-party', 'swiftie': 'swiftie-party', 'spa': 'spa-party', 'slime': 'slime-party', 'barbie': 'barbie-party',
  'sleep-under': 'sleep-under-party', 'sleepover-party': 'sleep-under-party', 'toddler': 'toddler-party', 'unicorn': 'unicorn-party',
  'race-car': 'race-car-party', 'racecar-party': 'race-car-party',
}

const ACTIVITY_ALIASES: Record<string, string> = {
  'slime-making': 'slime', 'make-your-own-slime': 'slime', 'slime-station': 'slime',
  'balloon-dogs': 'balloon-dog-painting', 'drip-paint-balloon-dogs': 'balloon-dog-painting', 'balloon-dog': 'balloon-dog-painting', 'drip-painting': 'balloon-dog-painting',
  'beaded-braids': 'hair-tinsel', 'hair-tinsel-beaded-braids': 'hair-tinsel', 'tinsel': 'hair-tinsel', 'hair-braids': 'hair-tinsel',
  'perfume': 'perfume-making', 'perfume-bar': 'perfume-making', 'make-your-own-perfume': 'perfume-making',
  'bracelets': 'bracelet-making', 'make-your-own-bracelets': 'bracelet-making', 'friendship-bracelets': 'bracelet-making',
  'trucker-hat': 'trucker-hat-bar', 'trucker-hats': 'trucker-hat-bar', 'hat-bar': 'trucker-hat-bar',
  'glitter-tattoo': 'glitter-tattoos', 'tattoos': 'glitter-tattoos',
  'lip-gloss': 'lip-gloss-charms', 'lip-gloss-making': 'lip-gloss-charms',
  'canvas': 'canvas-painting', 'painting': 'canvas-painting',
  'fake-cake-decorating': 'cake-decorating', 'cake': 'cake-decorating',
  'photobooth': 'photo-booth',
  'jewelry': 'permanent-jewelry', 'permanent-jewellery': 'permanent-jewelry',
  'soft-play-setup': 'soft-play',
  'manicures': 'manicure', 'nails': 'manicure',
  'glam-station': 'glam-makeup', 'makeup': 'glam-makeup', 'glittery-makeup': 'glam-makeup',
  'decoden-crafts': 'decoden',
  'sand-art-station': 'sand-art',
  'character': 'character-visit', 'princess-visit': 'character-visit',
  'face-painter': 'face-painting',
  'diy-sunglasses': 'sunglasses-craft', 'sunglass-craft': 'sunglasses-craft',
  'kiddie-karaoke': 'karaoke',
}

const DECOR_ALIASES: Record<string, string> = {
  'balloon-arches': 'balloon-arch', 'arch': 'balloon-arch', 'backdrops': 'backdrop', 'tent': 'tents', 'tables': 'table-setup', 'table': 'table-setup',
  'dessert-table': 'treat-table', 'treats': 'treat-table', 'candy': 'candy-wall',
}

/** Lowercase, hyphenate, strip anything that is not a tag character. */
export function slugifyTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_/&]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

export function canonicalTheme(raw: string | null | undefined): string | null {
  const s = slugifyTag(raw ?? '')
  if (!s || s === 'none' || s === 'unsure') return null
  return THEME_ALIASES[s] ?? s
}

function canonicalList(raw: string[], aliases: Record<string, string>): string[] {
  const out: string[] = []
  for (const r of raw) {
    const s = slugifyTag(r)
    if (!s || s === 'none') continue
    const c = aliases[s] ?? s
    if (!out.includes(c)) out.push(c)
  }
  return out
}

export const canonicalActivities = (raw: string[]) => canonicalList(raw, ACTIVITY_ALIASES)
export const canonicalDecor = (raw: string[]) => canonicalList(raw, DECOR_ALIASES)

/** Tags that survived normalisation but are in no vocabulary: shown to the admin so they can be mapped, never dropped. */
export function unknownTags(t: { theme?: string | null; activities?: string[]; decor?: string[] }): string[] {
  const out: string[] = []
  if (t.theme && !(THEME_TAGS as readonly string[]).includes(t.theme)) out.push(`theme:${t.theme}`)
  for (const a of t.activities ?? []) if (!(a in ACTIVITY_TAGS)) out.push(`activity:${a}`)
  for (const d of t.decor ?? []) if (!(d in DECOR_TAGS)) out.push(`decor:${d}`)
  return out
}
