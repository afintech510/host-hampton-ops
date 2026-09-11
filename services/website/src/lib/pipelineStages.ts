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
