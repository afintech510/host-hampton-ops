/**
 * Row types for migration 068 (spec §1). Column-for-column; nullable columns are
 * `| null`. Dates and timestamps arrive from PostgREST as ISO strings.
 */

export interface EviteRow {
  id: string
  booking_id: string
  slug: string
  previous_slugs: string[]
  template_slug: string
  /** Migration 070: the design the host or an admin chose; NULL = the theme's design. */
  template_choice: string | null
  /** Migration 073: the host's own finished invitation, an object in this row's `image_key` Storage folder. */
  custom_art: string | null
  theme_word: string | null
  theme_sub: string | null
  host_contact_name: string | null
  host_contact_phone: string | null
  show_host_contact: boolean
  host_note: string | null
  gift_note: string | null
  rsvp_deadline: string | null
  render_version: number
  render_inputs_hash: string | null
  image_key: string | null
  invite_object: string | null
  og_object: string | null
  rendered_at: string | null
  render_claim: string | null
  render_claimed_at: string | null
  render_error: string | null
  cal_version: number
  cal_inputs_hash: string | null
  cal_changed_at: string | null
  went_live_at: string | null
  cancelled_notice_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface EviteRsvpChild {
  first_name: string
}

export interface EviteRsvpRow {
  id: string
  evite_id: string
  status: 'yes' | 'no'
  revision: number
  parent_name: string
  children: EviteRsvpChild[]
  /** GENERATED ALWAYS from `children`; never written. */
  child_count: number
  adult_count: 0 | 1 | 2
  has_allergy: boolean | null
  allergy_note: string | null
  note_to_honoree: string | null
  reminder_email: string | null
  /** When `reminder_email` was last set or changed; non-null whenever the email is (migration 068 CHECK). */
  reminder_set_at: string | null
  reminder_phone_e164: string | null
  reminder_opt_out_at: string | null
  cal_version_seen: number
  club_email: string | null
  club_opt_in_at: string | null
  opt_in_text_version: string | null
  club_opted_out_at: string | null
  birthday_month: number | null
  contact_id: string | null
  consent_ip: string | null
  edit_nonce: string
  allergy_purged_at: string | null
  contacts_purged_at: string | null
  created_at: string
  updated_at: string
}

export const EVITE_SEND_TYPES = [
  'lead_preview',
  'invite_ready',
  'new_rsvp',
  'rsvp_changed',
  'rsvp_confirmed',
  'week_before',
  'day_before',
  'details_changed',
  'final_headcount',
  'party_cancelled',
] as const
export type EviteSendType = (typeof EVITE_SEND_TYPES)[number]

export interface EviteSendRow {
  id: string
  evite_id: string
  rsvp_id: string | null
  send_type: EviteSendType
  ref_version: number
  channel: 'email' | 'sms'
  status: 'sending' | 'sent' | 'failed' | 'skipped'
  attempts: number
  outcome: string | null
  provider_id: string | null
  last_error: string | null
  claimed_at: string
  sent_at: string | null
}

/**
 * The `bookings` columns the evite code reads (see `EVITE_BOOKING_COLUMNS` in
 * views.ts). `party_tags` and `quote_snapshot` are jsonb written by many
 * routes, so they are `unknown` and every reader must narrow them.
 */
export interface EviteBookingRow {
  id: string
  booking_ref: string | null
  status: string | null
  party_type: string | null
  event_type: string | null
  party_date: string | null
  party_time: string | null
  package_type: string | null
  guest_count_approx: number | null
  child_name: string | null
  child_age: number | null
  contact_name: string | null
  contact_email: string | null
  party_tags: unknown
  quote_snapshot: unknown
  created_at: string | null
}

/** The `booking_line_items` columns the evite theme resolver reads (`EVITE_LINE_ITEM_COLUMNS`). */
export interface EviteLineItemRow {
  name: string | null
  category: string | null
  pricing_item_id: string | null
}

/** The `party_themes` columns the evite theme resolver reads (`EVITE_PARTY_THEME_COLUMNS`). */
export interface PartyThemeRow {
  id: string
  name: string
  slug: string
  pricing_item_id: string | null
}

/** The `booking_payments` columns `inviteState` needs, i.e. what `sumPayments()` reads. */
export interface EvitePaymentRow {
  amount_cents: number | null
  payment_type: string | null
}
