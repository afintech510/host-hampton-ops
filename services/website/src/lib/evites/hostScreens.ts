/**
 * Input screens for the HOST's customise form (spec §7.2 PATCH, §13 "Inputs").
 *
 *   screenHostPatch(body, { today, partyDate, current }) -> { ok: true, columns } | { ok: false, field, message }
 *
 * Pure. Returns the `evites` columns to write, in snake_case, ready for `.update()`.
 *
 * THE ALLOW-LIST IS THIS FILE. Exactly seven keys are accepted:
 *
 *   host_note            <= 140 characters, '' -> NULL
 *   gift_note            <= 140 characters, '' -> NULL
 *   rsvp_deadline        'YYYY-MM-DD', today (ET) ... party date inclusive, or null. DISPLAY ONLY:
 *                        nothing refuses an RSVP after it
 *   show_host_contact    boolean
 *   host_contact_name    1..40 characters, '' / null -> NULL (the studio default, "Allie")
 *   host_contact_phone   exactly NNN-NNN-NNNN, first digit 2-9; '' / null -> NULL (the studio line)
 *   template_choice      a GALLERY template slug (`isGallerySlug`), or null -> NULL (the theme's
 *                        design). Migration 070. `plain`, an unregistered slug or anything else is a 400
 *
 * Any other key - `id`, `slug`, `theme_word`, `render_version`, `archived_at`, `booking_id`,
 * anything - is a 400 that names it. Never ignored: a silently dropped field reads as "saved".
 *
 * The phone is printed into a PUBLIC IMAGE (the invitation's "Any questions?" line), and the
 * image is posted to strangers' group chats, so the server accepts one spelling and nothing
 * else - no letters, no extensions, no "+1". `formatHostPhone` is the friendly half for the
 * FORM ("(631) 555-1234" -> "631-555-1234"); the server does not run it.
 *
 * `rsvp_deadline` is validated only when it CHANGES. A deadline that was valid when it was set
 * and has since passed must not make an unrelated edit (the gift note) fail, so a value equal to
 * the stored one is accepted as-is.
 */

import { screenName, screenNote } from '@/lib/evites/screens'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { formatHostPhone, isHostPhone } from '@/lib/evites/hostUi'
import { isGallerySlug } from '@/lib/evites/templates'

export const HOST_NOTE_MAX = 140
export const GIFT_NOTE_MAX = 140
export const HOST_CONTACT_NAME_MAX = 40

/** The seven keys, in form order (the design picker is its own control, saved on its own). */
export const HOST_PATCH_KEYS = [
  'host_note',
  'gift_note',
  'rsvp_deadline',
  'show_host_contact',
  'host_contact_name',
  'host_contact_phone',
  'template_choice',
] as const
export type HostPatchKey = (typeof HOST_PATCH_KEYS)[number]

export { formatHostPhone, isHostPhone }

export interface HostPatchContext {
  /** Eastern calendar date today, `YYYY-MM-DD` (`etDateString`). */
  today: string
  /** `bookings.party_date`, or null when the booking has no date yet. */
  partyDate: string | null
  /** The stored values, so an unchanged deadline is not re-checked. */
  current: { rsvp_deadline: string | null }
}

/** The columns a screened patch writes. Only the keys the host actually sent are present. */
export interface HostPatchColumns {
  host_note?: string | null
  gift_note?: string | null
  rsvp_deadline?: string | null
  show_host_contact?: boolean
  host_contact_name?: string | null
  host_contact_phone?: string | null
  template_choice?: string | null
}

export type HostPatchResult =
  | { ok: true; columns: HostPatchColumns }
  | { ok: false; field: string; message: string }

const bad = (field: string, message: string): { ok: false; field: string; message: string } => ({ ok: false, field, message })

export function screenHostPatch(body: unknown, ctx: HostPatchContext): HostPatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body', 'Please fill in the form.')
  const o = body as Record<string, unknown>

  for (const k of Object.keys(o)) {
    if (!(HOST_PATCH_KEYS as readonly string[]).includes(k)) return bad(k, 'That setting cannot be changed here.')
  }
  const has = (k: HostPatchKey) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined
  const columns: HostPatchColumns = {}

  // ---- the two notes
  if (has('host_note')) {
    if (o.host_note !== null && typeof o.host_note !== 'string') return bad('host_note', 'Please enter a short note.')
    const n = o.host_note === null ? '' : screenNote(o.host_note, HOST_NOTE_MAX)
    if (n === null) return bad('host_note', `Please keep your note to ${HOST_NOTE_MAX} characters.`)
    columns.host_note = n === '' ? null : n
  }
  if (has('gift_note')) {
    if (o.gift_note !== null && typeof o.gift_note !== 'string') return bad('gift_note', 'Please enter a short note.')
    const n = o.gift_note === null ? '' : screenNote(o.gift_note, GIFT_NOTE_MAX)
    if (n === null) return bad('gift_note', `Please keep your gift note to ${GIFT_NOTE_MAX} characters.`)
    columns.gift_note = n === '' ? null : n
  }

  // ---- the RSVP-by date (display only)
  if (has('rsvp_deadline')) {
    const v = o.rsvp_deadline
    if (v === null || v === '') {
      columns.rsvp_deadline = null
    } else if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || validPartyDate(v) === null) {
      return bad('rsvp_deadline', 'Please choose a date.')
    } else if (v === ctx.current.rsvp_deadline) {
      columns.rsvp_deadline = v
    } else if (v < ctx.today) {
      return bad('rsvp_deadline', 'Please choose today or a later date.')
    } else if (ctx.partyDate && v > ctx.partyDate) {
      return bad('rsvp_deadline', 'Please choose a date on or before the party.')
    } else {
      columns.rsvp_deadline = v
    }
  }

  // ---- the "Any questions?" line
  if (has('show_host_contact')) {
    if (typeof o.show_host_contact !== 'boolean') return bad('show_host_contact', 'Please choose show or hide.')
    columns.show_host_contact = o.show_host_contact
  }
  if (has('host_contact_name')) {
    const v = o.host_contact_name
    if (v === null || (typeof v === 'string' && v.trim() === '')) columns.host_contact_name = null
    else {
      const n = screenName(v, HOST_CONTACT_NAME_MAX)
      if (n === null) return bad('host_contact_name', `Please enter a name of up to ${HOST_CONTACT_NAME_MAX} characters.`)
      columns.host_contact_name = n
    }
  }
  if (has('host_contact_phone')) {
    const v = o.host_contact_phone
    if (v === null || v === '') columns.host_contact_phone = null
    else if (!isHostPhone(v)) return bad('host_contact_phone', 'Please enter a US phone number in the form NNN-NNN-NNNN, or leave it blank to use the studio line.')
    else columns.host_contact_phone = v
  }

  // ---- the design (the gallery pick)
  if (has('template_choice')) {
    const v = o.template_choice
    if (v === null || v === '') columns.template_choice = null
    else if (!isGallerySlug(v)) return bad('template_choice', 'Please choose one of the designs shown.')
    else columns.template_choice = v
  }

  if (Object.keys(columns).length === 0) return bad('body', 'Nothing to update.')
  return { ok: true, columns }
}
