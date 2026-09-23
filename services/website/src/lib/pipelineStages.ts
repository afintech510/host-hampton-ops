/**
 * The party pipeline — one list, shared by the admin API and the admin UI.
 *
 * A leaf module on purpose: `PartiesTab.tsx` is a client component, so this
 * cannot live in `lib/plan.ts` (which imports the Supabase client and would
 * drag it into the browser bundle) and it cannot be exported from
 * `api/admin/parties/route.ts` either — a Next.js route file may only export
 * route handlers, which is a build error rather than a warning.
 *
 * The set matches `bookings_status_check` from migration 035.
 */

/**
 * Pipeline order, as the Parties tab renders it left to right.
 *
 * `cancelled` is deliberately absent: it is an exit from the pipeline, not a
 * stage in it, so the UI hangs it off the end rather than putting it in the
 * flow. `confirmed` is absent too — it is a legacy status that `api/checkout`
 * writes and two live rows use; migration 035 kept it in the CHECK for that
 * reason, but it is not a stage anyone works a lead through.
 */
export const PIPELINE_STAGES = [
  'lead',
  'quoted',
  'pending_review',
  'awaiting_deposit',
  'deposit_paid',
  'approved',
  'modifications_locked',
  'paid_in_full',
  'completed',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/**
 * Stages at which a plan is priced but not yet paid — the window in which the
 * customer must be able to see a deposit button.
 *
 * This set exists because it was written twice and the two copies disagreed.
 * The party builder's pay block tested `status === 'awaiting_deposit'` alone,
 * while `/api/party-builder/save` only ever wrote that status when it CREATED a
 * booking: quoting a lead that arrived through the website form took the UPDATE
 * path, which never touched `status`. So a real customer (HH-PTY-SEJ4P, Lauren
 * Kovar, 2026-09-23) opened her plan on a $750 party and had no payment module
 * at all, and the admin panel had no button that applied either — `lead` is in
 * neither this list nor the approve condition. A second live plan
 * (HH-PTY-KMXWM, $1,250, `quoted`) was in the same hole.
 *
 * `quoted` is here as well as `lead` because it means the same thing to a
 * customer looking at the page: we have priced this and nobody has paid.
 */
export const PRE_DEPOSIT_STAGES = ['lead', 'quoted', 'awaiting_deposit'] as const

/**
 * May this plan still show the customer a "pay your deposit" module?
 *
 * A plan with no booking row yet (a fresh planner session) answers true — the
 * builder has always offered the pay block before the first save, and that is
 * the request flow that creates the booking.
 */
export function canTakeDeposit(status: string | null | undefined): boolean {
  if (status == null) return true
  return (PRE_DEPOSIT_STAGES as readonly string[]).includes(status)
}

/**
 * Should pricing this plan move it forward to `awaiting_deposit`?
 *
 * Only from the two stages that precede it. Deliberately NOT "anything that is
 * not awaiting_deposit": re-saving a plan that is `approved` or `paid_in_full`
 * must not walk its status backwards, which is exactly what a naive
 * `status = 'awaiting_deposit'` on every update would do.
 */
export function shouldAdvanceToAwaitingDeposit(status: string | null | undefined): boolean {
  return status === 'lead' || status === 'quoted'
}

/** `bookings.party_type` values from migration 035, plus 'all' for the filter. */
export const PARTY_TYPES = ['in_studio_theme', 'mobile_party', 'studio_rental', 'unknown'] as const

export type PartyTypeValue = (typeof PARTY_TYPES)[number]

export const PARTY_TYPE_LABELS: Record<string, string> = {
  in_studio_theme: 'In-Studio Theme',
  mobile_party: 'Mobile',
  studio_rental: 'Studio Rental',
  unknown: 'Unclassified',
}

export function isPartyType(v: string | null | undefined): v is PartyTypeValue {
  return !!v && (PARTY_TYPES as readonly string[]).includes(v)
}

/**
 * Best-effort `event_type` → `party_type` classification, for the writers that
 * have only the form's own words to go on.
 *
 * Migration 035 added `party_type` and backfilled the rows that existed then,
 * but `/api/admin/bookings` — the hand-entered booking Adam creates when
 * someone books over the phone — never set it at all, so every manual booking
 * since has landed `NULL` and rendered as "Unclassified". Two real October
 * parties (HH-2026-7984, HH-2026-8060) sat there on 2026-09-13. A default is
 * not a substitute for the Type control in the Parties tab; it is there so the
 * common case is right without anyone remembering.
 *
 * Order matters. "mobile" is checked before anything else because a mobile
 * booking's words are otherwise indistinguishable from an in-studio one, and
 * the rental words are checked before the party words because "rent the space
 * for photoshoots" is a rental that happens to mention neither. Bare 'studio'
 * is deliberately NOT a rental signal — "in-studio party" contains it.
 */
export function classifyPartyType(eventType: string | null | undefined): PartyTypeValue {
  const s = (eventType || '').toLowerCase()
  if (!s.trim()) return 'unknown'
  if (/\bmobile\b|at[-\s]?home|we come to you/.test(s)) return 'mobile_party'
  if (/rental|rent the|renting|photoshoot|photo shoot|room[-\s]?rent/.test(s)) return 'studio_rental'
  if (/party|parties|birthday|\bkid|shower|celebration/.test(s)) return 'in_studio_theme'
  return 'unknown'
}
