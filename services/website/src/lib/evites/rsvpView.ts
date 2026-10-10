/**
 * What a guest is allowed to be shown about their OWN RSVP (spec §7.5, E2).
 *
 * `PUBLIC_RSVP_SELF_COLUMNS` is the allow-list; `ownRsvpView` is the only
 * serialiser. A row from the database is reduced to exactly those keys, so a
 * select that grew a column (`id`, `evite_id`, `edit_nonce`, `consent_ip`,
 * `contact_id`, the purge flags) still cannot leak it: the response is built
 * from the list, not from the row.
 */

import { PUBLIC_RSVP_SELF_COLUMNS } from '@/lib/evites/views'

export type OwnRsvp = {
  status: 'yes' | 'no'
  revision: number
  parent_name: string
  children: Array<{ first_name: string }>
  adult_count: number
  has_allergy: boolean | null
  allergy_note: string | null
  note_to_honoree: string | null
  reminder_email: string | null
  reminder_phone_e164: string | null
  reminder_opt_out_at: string | null
  club_email: string | null
  club_opt_in_at: string | null
  club_opted_out_at: string | null
  birthday_month: number | null
  created_at: string
  updated_at: string
}

/** The `select` list for an own-RSVP read. `id` leads for callers that must know it; it is NEVER serialised. */
export const OWN_RSVP_SELECT = ['id', ...PUBLIC_RSVP_SELF_COLUMNS].join(', ')

export function ownRsvpView(row: Record<string, unknown>): OwnRsvp {
  const out: Record<string, unknown> = {}
  for (const col of PUBLIC_RSVP_SELF_COLUMNS) out[col] = row[col] === undefined ? null : row[col]
  return out as unknown as OwnRsvp
}
