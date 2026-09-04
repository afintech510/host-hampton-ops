/**
 * Arts-and-crafts stations featured on the mobile craft party pages.
 *
 * A craft-forward subset of the full mobile-party menu — the hands-on making
 * activities that match "craft party" / "art party" search intent. The full
 * mix-and-match menu (spa, glam, photobooth, etc.) still lives on /mobile-party.
 */

export interface CraftStation {
  emoji: string
  name: string
  /** One line describing what the kids actually make/do. */
  blurb: string
}

export const CRAFT_STATIONS: CraftStation[] = [
  { emoji: '🎨', name: 'Canvas Painting',        blurb: 'Every kid paints their own canvas to take home — smocks, easels, and paints included.' },
  { emoji: '🏖️', name: 'Sand Art',               blurb: 'Layer colored sand into bottles and keepsakes — mess-free and a hit with every age.' },
  { emoji: '🐩', name: 'Drip-Paint Balloon Dogs', blurb: 'Our signature: pour and drip paint over balloon-dog figures for a glossy, one-of-a-kind piece.' },
  { emoji: '🟢', name: 'Slime Station',           blurb: 'Kids mix, stretch, and customize their own slime with glitter and charms to bring home.' },
  { emoji: '🐚', name: 'Seashell Decorating',     blurb: 'Decorate and glam real seashells — perfect for beach-house and shore-town parties.' },
  { emoji: '📿', name: 'Bracelet Making',         blurb: 'Beads, charms, and letter tiles to string custom bracelets and friendship sets.' },
  { emoji: '👜', name: 'Canvas Bag Bar',          blurb: 'Design a tote with iron-on patches and paint — a wearable party favor.' },
  { emoji: '🧢', name: 'Trucker Hat Bar',         blurb: 'Curated patches and pins to build a custom hat everyone wears home.' },
  { emoji: '⛑️', name: 'Construction Hat Craft',  blurb: 'Decorate-your-own hard hats — a favorite for younger builders.' },
  { emoji: '🕶️', name: 'Sunglass Craft',          blurb: 'Bedazzle and customize sunglasses with gems, charms, and paint.' },
  { emoji: '🎀', name: 'Decoden Crafts',          blurb: 'Whipped-clay “decoden” cases and trinkets loaded with cute charms.' },
  { emoji: '🌸', name: 'Perfume Making',          blurb: 'Blend a signature scent and bottle it — part science, part craft.' },
]
