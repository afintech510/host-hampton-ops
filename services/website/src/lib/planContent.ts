/**
 * Plan content — the invoice's PROSE, per party type (Phase 5 item 1).
 *
 * `pricingCatalog.ts` moved the numbers out of TypeScript; this moves the words.
 * Migration 037 seeds `plan_content` with what `SKILL.md` told a human to type
 * by hand: "What's Included" (studio only), the good-to-know paragraph, the
 * policy bullets, the deposit label and note, the add-ons intro.
 *
 * Built on the same two rules as the pricing catalog, for the same reasons:
 *
 * 1. **The fallback is the seeded copy, never empty.** An unapplied migration or
 *    an unreachable Supabase renders today's invoice rather than a page with a
 *    hole in it. Missing policy copy is not cosmetic — the setup/cleanup and
 *    sweep-clean bullets are what we point at when a room is left dirty, so a
 *    quote that silently omits them is worse than a stale one.
 *
 * 2. **Only a complete read is cached.** Learned from `pricingCatalog`, where
 *    `fromDb` asked whether the KEYS were present rather than whether the VALUES
 *    came from the DB, and a per-field fallback got cached for a minute — which
 *    makes correcting a row look like it did nothing.
 *
 * `party_type` falls back to the shared `'all'` rows, so a lead still classified
 * `unknown` renders a complete page instead of a partial one.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export const CONTENT_SLOTS = [
  'whats_included',
  'good_to_know',
  'policy',
  'deposit_note',
  'deposit_label',
  'addons_intro',
  'balance_note',
] as const

export type ContentSlot = (typeof CONTENT_SLOTS)[number]

export interface PlanContentRow {
  party_type: string
  slot: string
  body: string
  sort_order: number | null
}

/** Every slot for one party type, already resolved against the `'all'` rows. */
export interface PlanContent {
  whatsIncluded: string[]
  goodToKnow: string[]
  policies: string[]
  depositLabel: string
  depositNote: string
  addonsIntro: string
  balanceNote: string | null
  /** False when any of this came from the compiled fallback. */
  fromDb: boolean
}

/**
 * Byte-for-byte the seed in migration 037. Kept in sync deliberately rather
 * than generated: the point of a fallback is that it works when the DB does not.
 */
export const FALLBACK_CONTENT_ROWS: PlanContentRow[] = [
  { party_type: 'studio_rental', slot: 'whats_included', body: 'Tables', sort_order: 1 },
  { party_type: 'studio_rental', slot: 'whats_included', body: 'Chairs', sort_order: 2 },
  { party_type: 'studio_rental', slot: 'whats_included', body: 'Dessert cart', sort_order: 3 },
  { party_type: 'studio_rental', slot: 'whats_included', body: 'WiFi', sort_order: 4 },
  { party_type: 'studio_rental', slot: 'whats_included', body: 'Bluetooth speakers', sort_order: 5 },
  {
    party_type: 'studio_rental', slot: 'whats_included', sort_order: 6,
    body: 'Retail items removed & furniture consolidated to maximize your usable party space',
  },
  {
    party_type: 'studio_rental', slot: 'policy', sort_order: 1,
    body: '**Setup & cleanup time is included in your rental window** — plan to arrive early enough to set up and leave enough time at the end to clean up within your booked hours (or add Additional Hours if you need more time).',
  },
  {
    party_type: 'studio_rental', slot: 'policy', sort_order: 2,
    body: "**Please leave the room sweep-clean and take your garbage with you** when you go, unless you've added the Garbage Service or Full Clean-up Service add-on.",
  },
  {
    party_type: 'studio_rental', slot: 'good_to_know', sort_order: 1,
    body: "Your rental is the whole studio, privately yours for the booked window. Tell us your setup plans ahead of time and we'll have the room arranged before you arrive.",
  },
  { party_type: 'studio_rental', slot: 'deposit_label', body: 'Security Deposit — Required to Book', sort_order: 1 },
  {
    party_type: 'studio_rental', slot: 'deposit_note', sort_order: 1,
    body: 'Separate from your Total, due now to reserve the date, and fully refundable after the event assuming no damage.',
  },
  {
    party_type: 'studio_rental', slot: 'balance_note', sort_order: 1,
    body: 'Your deposit is separate and is not deducted from this total.',
  },
  {
    party_type: 'mobile_party', slot: 'good_to_know', sort_order: 1,
    body: 'We come to you — our host brings every supply, apron and surface cover, runs the activity start to finish, and leaves your space as we found it.',
  },
  { party_type: 'mobile_party', slot: 'deposit_label', body: 'Reservation Deposit — Required to Book', sort_order: 1 },
  {
    party_type: 'mobile_party', slot: 'deposit_note', sort_order: 1,
    body: 'Separate from your Total and due now to reserve the date. It comes off your balance on the day.',
  },
  {
    party_type: 'in_studio_theme', slot: 'good_to_know', sort_order: 1,
    body: "Your party is hosted at the studio with everything set up before your guests arrive. Tell us your theme and we'll take it from there.",
  },
  { party_type: 'in_studio_theme', slot: 'deposit_label', body: 'Reservation Deposit — Required to Book', sort_order: 1 },
  {
    party_type: 'in_studio_theme', slot: 'deposit_note', sort_order: 1,
    body: 'Separate from your Total and due now to reserve the date. It comes off your balance on the day.',
  },
  { party_type: 'all', slot: 'deposit_label', body: 'Reservation Deposit — Required to Book', sort_order: 1 },
  { party_type: 'all', slot: 'deposit_note', body: 'Separate from your Total and due now to reserve the date.', sort_order: 1 },
  {
    party_type: 'all', slot: 'addons_intro', sort_order: 1,
    body: "Popular additions for this party — ask us to add any of these and we'll send an updated quote.",
  },
  {
    party_type: 'all', slot: 'good_to_know', sort_order: 1,
    body: "Everything above is a quote, not a charge. Nothing is booked until the deposit is paid, and we'll confirm every detail with you first.",
  },
]

/**
 * Resolve one party type's content out of a row set.
 *
 * A slot is taken from the party type's own rows when it has any, and from the
 * shared `'all'` rows otherwise. It is NOT a merge: a party type that defines
 * `good_to_know` replaces the shared paragraph rather than appending to it,
 * because two "good to know" paragraphs on one invoice reads as an editing
 * mistake.
 */
export function contentFromRows(rows: PlanContentRow[], partyType: string): PlanContent {
  const pick = (slot: ContentSlot): string[] => {
    const bySort = (a: PlanContentRow, b: PlanContentRow) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    const own = rows.filter(r => r.party_type === partyType && r.slot === slot).sort(bySort)
    const shared = rows.filter(r => r.party_type === 'all' && r.slot === slot).sort(bySort)
    return (own.length ? own : shared).map(r => r.body).filter(b => typeof b === 'string' && b.trim() !== '')
  }

  const one = (slot: ContentSlot, fallback: string): string => pick(slot)[0] ?? fallback

  // Studio rental is the only type with a What's Included block — SKILL.md is
  // explicit that a mobile quote omits it, because its inclusions belong in the
  // featured line item's description.
  const whatsIncluded = pick('whats_included')

  return {
    whatsIncluded,
    goodToKnow: pick('good_to_know'),
    policies: pick('policy'),
    depositLabel: one('deposit_label', 'Reservation Deposit — Required to Book'),
    depositNote: one('deposit_note', 'Separate from your Total and due now to reserve the date.'),
    addonsIntro: one('addons_intro', ''),
    balanceNote: pick('balance_note')[0] ?? null,
    fromDb: false,
  }
}

const CACHE_TTL_MS = 60_000
let cache: { at: number; rows: PlanContentRow[] } | null = null

/** Drop the cache. Exported for tests and for an admin copy edit. */
export function clearPlanContentCache(): void {
  cache = null
}

/**
 * Load the content for one party type. NEVER throws and never returns an empty
 * page: on any failure it logs and falls back to the compiled seed.
 */
export async function loadPlanContent(partyType: string, supabase?: Supa): Promise<PlanContent> {
  const type = partyType || 'unknown'

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...contentFromRows(cache.rows, type), fromDb: true }
  }

  try {
    const db = supabase ?? getSupabase()
    const { data, error } = await db
      .from('plan_content')
      .select('party_type, slot, body, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !data?.length) {
      if (error) console.error('loadPlanContent error (using fallback):', error.message)
      return contentFromRows(FALLBACK_CONTENT_ROWS, type)
    }

    const rows = data as PlanContentRow[]
    cache = { at: Date.now(), rows }
    return { ...contentFromRows(rows, type), fromDb: true }
  } catch (err) {
    console.error('loadPlanContent threw (using fallback):', err)
    return contentFromRows(FALLBACK_CONTENT_ROWS, type)
  }
}
