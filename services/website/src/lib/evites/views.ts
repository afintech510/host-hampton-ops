/**
 * Column allow-lists for evite reads (spec §2 `views.ts`, §7.2, §7.3, §13).
 *
 * There is no `select('*')` anywhere in evite code (tripwire E5). Each list is
 * an ALLOW-list on purpose: a column added by a later migration stays private
 * until somebody decides otherwise. Use as `.select(LIST.join(', '))`.
 *
 * Which list goes where:
 *   EVITE_BOOKING_COLUMNS      server-side booking read (never sent to a browser as-is)
 *   EVITE_LOOKUP_COLUMNS       "does this booking already have an evite, and which"
 *   PUBLIC_RSVP_SELF_COLUMNS   the caller's OWN rsvp, returned to the guest
 *   HOST_RSVP_COLUMNS          the host's list (spec §7.2, exactly)
 *   ADMIN_RSVP_COLUMNS         the admin card (spec §7.3)
 */

/** `bookings` columns the evite code reads. Every one exists in production. */
export const EVITE_BOOKING_COLUMNS = [
  'id',
  'booking_ref',
  'status',
  'party_type',
  'event_type',
  'party_date',
  'party_time',
  'package_type',
  'guest_count_approx',
  'child_name',
  'child_age',
  'contact_name',
  'contact_email',
  'party_tags',
  'quote_snapshot',
  'created_at',
] as const

/** Enough of an `evites` row to say "it exists" (archived or not) and to link it. */
export const EVITE_LOOKUP_COLUMNS = ['id', 'booking_id', 'slug', 'archived_at'] as const

/**
 * What a guest gets back about their OWN rsvp. Never `id`, `evite_id`,
 * `edit_nonce`, `consent_ip`, `contact_id`, the purge flags or `cal_version_seen`.
 * The guest typed their reminder contact and club email themselves, so they may
 * be shown back to them (the edit screen prefills from them).
 */
export const PUBLIC_RSVP_SELF_COLUMNS = [
  'status',
  'revision',
  'parent_name',
  'children',
  'adult_count',
  'has_allergy',
  'allergy_note',
  'note_to_honoree',
  'reminder_email',
  'reminder_phone_e164',
  'reminder_opt_out_at',
  'club_email',
  'club_opt_in_at',
  'club_opted_out_at',
  'birthday_month',
  'created_at',
  'updated_at',
] as const

/**
 * Spec §7.2, exactly. **Never reminder contacts, club fields or IP.**
 */
export const HOST_RSVP_COLUMNS = [
  'status',
  'parent_name',
  'children',
  'adult_count',
  'has_allergy',
  'allergy_note',
  'note_to_honoree',
  'created_at',
  'updated_at',
] as const

/**
 * Spec §7.3. Excludes the raw reminder email/phone, club email and IP: they are
 * revealed one RSVP at a time through a separate, logged `?reveal=<rsvpId>`.
 * "Club opted in" is `club_opt_in_at`; the purge flags are the two `*_purged_at`.
 */
export const ADMIN_RSVP_COLUMNS = [
  'id',
  'status',
  'revision',
  'parent_name',
  'children',
  'child_count',
  'adult_count',
  'has_allergy',
  'allergy_note',
  'note_to_honoree',
  'reminder_opt_out_at',
  'club_opt_in_at',
  'club_opted_out_at',
  'allergy_purged_at',
  'contacts_purged_at',
  'created_at',
  'updated_at',
] as const

/** `booking_line_items` columns the theme resolver reads. No `select('*')`. */
export const EVITE_LINE_ITEM_COLUMNS = ['name', 'category', 'pricing_item_id'] as const

/** `party_themes` columns the theme resolver reads. */
export const EVITE_PARTY_THEME_COLUMNS = ['id', 'name', 'slug', 'pricing_item_id'] as const

/** `booking_payments` columns `inviteState` needs (the pair `sumPayments()` reads). */
export const EVITE_PAYMENT_COLUMNS = ['amount_cents', 'payment_type'] as const

/**
 * What the PUBLIC page `/i/[slug]` reads from `evites` (spec §7.4). The facts
 * need the invitation-specific choices; the OG card needs the stored object
 * names. Nothing about renders in flight (`render_claim`, `render_error`),
 * calendar bookkeeping, consent or the slug history: a column added later stays
 * private until somebody decides otherwise. `id` and `booking_id` are for the
 * server only and are never serialised to the browser.
 */
export const EVITE_PAGE_COLUMNS = [
  'id',
  'booking_id',
  'slug',
  'template_slug',
  'theme_word',
  'theme_sub',
  'host_contact_name',
  'host_contact_phone',
  'show_host_contact',
  'host_note',
  'gift_note',
  'rsvp_deadline',
  'image_key',
  'invite_object',
  'og_object',
  'archived_at',
] as const

/**
 * What the SEND path reads from `evites` (P09; spec §9). Everything the facts need,
 * plus the calendar and lifecycle bookkeeping the sends key on (`cal_version`,
 * `cal_changed_at`, `went_live_at`, `cancelled_notice_at`) and the stored image names.
 * SERVER-ONLY: nothing here is ever serialised to a browser.
 */
export const EVITE_SEND_COLUMNS = [
  'id',
  'booking_id',
  'slug',
  'template_slug',
  'theme_word',
  'theme_sub',
  'host_contact_name',
  'host_contact_phone',
  'show_host_contact',
  'host_note',
  'gift_note',
  'rsvp_deadline',
  'image_key',
  'invite_object',
  'og_object',
  'render_inputs_hash',
  'cal_version',
  'cal_inputs_hash',
  'cal_changed_at',
  'went_live_at',
  'cancelled_notice_at',
  'archived_at',
  'created_at',
] as const

/**
 * What the SEND path reads from `evite_rsvps`. This list DOES carry `reminder_email`
 * (the recipient of a guest email) and `edit_nonce` (to sign the guest's own edit link),
 * which is exactly why it is a separate list from every browser-facing one above:
 * SERVER-ONLY, used to build one email and dropped. Never club fields, IP or the phone.
 */
export const EVITE_SEND_RSVP_COLUMNS = [
  'id',
  'evite_id',
  'status',
  'revision',
  'parent_name',
  'children',
  'adult_count',
  'has_allergy',
  'allergy_note',
  'note_to_honoree',
  'reminder_email',
  'reminder_opt_out_at',
  'cal_version_seen',
  'edit_nonce',
  'created_at',
] as const
