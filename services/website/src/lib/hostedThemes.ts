import { getSupabase } from '@/lib/supabase'
import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'
import { usd } from '@/lib/partyCostFaq'
import type { GuestRules } from '@/lib/pricingCatalog'
import type { CraftFaq } from '@/lib/craftParties'

/**
 * Themes we have actually hosted — the "we can do anything" page (/party-themes),
 * the short strip on /party-packages, and a section of /llms.txt.
 *
 * WHY. /party-packages shows the ten-or-so signature packages, and that is all
 * a crawler or an answer engine ever saw. A parent asking for "a Minecraft
 * party" or "a Stitch party on Long Island" found nothing of ours, though we
 * have run both. Much of what the studio hosts is a CUSTOM theme — "Custom
 * Party Theme" is the single most common theme on live bookings (12, checked
 * 2026-10-11) — and the theme itself was recorded nowhere a page could read.
 *
 * EVERY ENTRY IS A PARTY THAT HAPPENED. Sources, 2026-10-11: Adam's own past
 * invitations, plus an aggregate read of `bookings.package_type` /
 * `party_tags.theme` / `booking_line_items` (theme names and counts only — no
 * customer or child names were read). Do not add a theme here because it would
 * rank; add it when we have hosted it. `tagline` is the headline from that
 * party's real invitation; `note` is ours.
 *
 * Character and brand names are DESCRIPTIVE — the theme a parent asked for. We
 * design these ourselves; nothing here may say or imply "official" or
 * "licensed", and the page says so in plain words.
 *
 * NO PRICES IN THIS FILE. The one figure the page states is read from the
 * `Custom Party Theme` row checkout charges from (`loadCustomThemePriceCents`).
 */

export interface HostedTheme {
  name: string
  /** The headline from the real invitation, when it had one. Rendered in quotes. */
  tagline?: string
  /** A plain description, when the name needs one. */
  note?: string
  /** A page of ours about this theme, when one exists. */
  href?: string
}

export interface HostedThemeGroup {
  id: string
  title: string
  blurb: string
  themes: HostedTheme[]
}

export const HOSTED_THEME_GROUPS: HostedThemeGroup[] = [
  {
    id: 'characters',
    title: 'Characters & Favorite Shows',
    blurb: 'The game, show or character they can’t stop talking about, turned into the whole party.',
    themes: [
      { name: 'Lilo & Stitch' },
      { name: 'Minecraft' },
      { name: 'Hello Kitty', note: 'Spa party and toddler party' },
      { name: 'Barbie Disco & Barbie Glam' },
      { name: 'K-Pop Demon Hunters' },
      { name: 'Squishmallow Spa Party' },
      { name: 'Princess, Dragon & Knight' },
    ],
  },
  {
    id: 'animals',
    title: 'Ponies, Unicorns & Under the Sea',
    blurb: 'Soft colors, sparkle and a lot of glitter — for the animal lovers.',
    themes: [
      { name: 'Mermaid', note: 'Including a mermaid pool party', href: '/mermaid-party' },
      { name: 'Sea Animals' },
      { name: 'Watercolor Unicorn' },
      { name: 'Horse & Cowgirl', tagline: 'Saddle Up' },
      { name: 'Pink Pony Club', note: 'Cowgirl ponies' },
    ],
  },
  {
    id: 'glow',
    title: 'Glow, Neon & Disco',
    blurb: 'Black lights, neon and a dance floor — the studio turns into a club for kids.',
    themes: [
      { name: 'Neon Glow', tagline: 'Let’s Glow', href: '/glow-party' },
      { name: 'Neon Disco Glow' },
      { name: 'Neon Slime', href: '/slime-party' },
    ],
  },
  {
    id: 'crafty',
    title: 'Crafty, Sweet & Hands-On',
    blurb: 'Parties built around making something — and every guest takes it home.',
    themes: [
      { name: 'Pastel Slime', href: '/slime-party' },
      { name: 'Donuts', tagline: 'Two Sweet' },
      { name: 'Sweets & Treats Decorating' },
      { name: 'Trucker Hat & Patch Bar' },
      { name: 'Sand Art, Hair Tinsel & Glitter Tattoos' },
    ],
  },
  {
    id: 'glam',
    title: 'Glam, Spa & Sleepovers',
    blurb: 'Robes, mini manicures and cozy tents — pampering, styled to their taste.',
    themes: [
      { name: 'Spa Party', href: '/spa-party' },
      { name: 'LoveShackFancy-Style Florals' },
      { name: 'Sleep Under', note: 'Styled sleepover tents' },
    ],
  },
  {
    id: 'little-ones',
    title: 'Little Ones, Trucks & Builders',
    blurb: 'Gentle, colorful parties for toddlers and first birthdays — and for the kids who love anything with wheels.',
    themes: [
      { name: 'Toddler Party', href: '/toddler-party' },
      { name: 'First Birthday', href: '/first-birthday-parties' },
      { name: 'Construction', tagline: 'Stop the traffic' },
      { name: 'Transportation', tagline: 'Honk, beep, vroom' },
    ],
  },
]

/** Every hosted theme, in page order. */
export function allHostedThemes(): HostedTheme[] {
  return HOSTED_THEME_GROUPS.flatMap(g => g.themes)
}

/** The /party-themes title and description, here so the length budget can be tested. */
export const PARTY_THEMES_META = {
  title: 'Kids Party Themes We’ve Hosted — Any Theme',
  description:
    'Minecraft, Stitch, Hello Kitty, mermaids, cowgirls, construction and more — kids party themes we’ve hosted on Long Island. Any theme, made to your vibe.',
}

/** The four things we design around a theme — the page and /llms.txt say the same. */
export const CUSTOMIZED_FOR_THEME = [
  { title: 'Decor & setup', desc: 'Colors, tablescape and the whole room styled to the theme — set up before you arrive.' },
  { title: 'Activities', desc: 'Crafts, games and stations matched to what they love, run by your host.' },
  { title: 'Take-homes', desc: 'Whatever the kids make goes home with them, in the party’s colors.' },
  { title: 'The invitation', desc: 'Your Host Hampton EVITE, designed to match the party.' },
]

/**
 * The pricing row the planner charges a custom theme at. Read by NAME because
 * it is the one row of its kind; if it is renamed or deactivated this returns
 * null, says so, and the page simply drops its cost answer rather than print a
 * figure nobody is charging.
 */
export const CUSTOM_THEME_ITEM_NAME = 'Custom Party Theme'

export async function loadCustomThemePriceCents(): Promise<number | null> {
  try {
    const { data, error } = await getSupabase()
      .from('pricing_items')
      .select('price_cents')
      .eq('category', 'party-theme')
      .eq('name', CUSTOM_THEME_ITEM_NAME)
      .eq('is_active', true)
      .limit(1)
    if (error) {
      console.error('hostedThemes: custom theme price read failed —', error.message)
      return null
    }
    const cents = Number(data?.[0]?.price_cents)
    if (!(cents > 0)) {
      console.warn(`hostedThemes: no active priced "${CUSTOM_THEME_ITEM_NAME}" row — cost answer omitted`)
      return null
    }
    return cents
  } catch (err) {
    console.error('hostedThemes: custom theme price read threw —', err)
    return null
  }
}

/**
 * The /party-themes FAQ. It becomes FAQPage schema, so: the cost answer is
 * BUILT from the charged row (and omitted when that read fails), and no mobile
 * figure appears anywhere (plan §15) — at-home pricing is pointed at, not quoted.
 */
export function buildPartyThemesFaqs(customThemeCents: number | null, guestRules: GuestRules): CraftFaq[] {
  // Semicolons, because some names carry their own commas ("Princess, Dragon & Knight").
  const names = allHostedThemes().map(t => t.name)
  const faqs: CraftFaq[] = [
    {
      q: 'Can Host Hampton do a party theme that isn’t on your package list?',
      a:
        'Yes — any theme. Our party packages show our signature themes, but many of the parties we host are custom: ' +
        'Minecraft, Lilo & Stitch, Hello Kitty, construction, cowgirl ponies and more. Tell us what your child loves ' +
        'and we design the decor, activities, take-homes and the Host Hampton EVITE invitation around it.',
    },
    {
      q: 'What party themes has Host Hampton done?',
      a: `Recent themes include: ${names.join('; ')}. If yours isn’t here, ask — we can build it.`,
    },
    {
      q: 'Can you do a character party like Minecraft, Stitch or Hello Kitty?',
      a:
        'Yes. We style the decor, colors and activities around the characters your child loves. Character themes are ' +
        'our own designs inspired by the show or game — not official or licensed parties.',
    },
    {
      q: 'Can a custom theme be done at my house?',
      a:
        'Yes. We have brought custom themes — mermaids and sea animals, Barbie glam, LoveShackFancy-style florals — to ' +
        'homes across Long Island as mobile parties, as well as hosting them at our private studio in Speonk. ' +
        'At-home pricing is on our mobile party page.',
    },
  ]

  if (customThemeCents !== null) {
    faqs.push({
      q: 'How much does a custom theme party cost?',
      a:
        `At our private studio in Speonk, a custom theme party is ${usd(customThemeCents)} for 2 hours with ` +
        `${guestRules.includedGuests} kids plus the birthday child, a dedicated host, themed decor and setup, the activities, ` +
        `pizza, cupcakes, drinks and full cleanup. Extra kids are ${usd(guestRules.extraGuestCents)} each, and a flat ` +
        `${usd(BOOKING_DEPOSIT_CENTS)} deposit holds the date.`,
    })
  }
  return faqs
}
