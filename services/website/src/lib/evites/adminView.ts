/**
 * What the admin "Invitation & RSVPs" card is shown, and the pure rules behind
 * it (spec §7.3, HANDOFF §5).
 *
 * Phase-local on purpose: `views.ts` keeps `ADMIN_RSVP_COLUMNS` (the rows the card
 * lists). This file adds the other allow-lists the admin route needs, and every
 * pure reduction of those rows (headcount, allergy roll-up, the send ledger,
 * theme input screening, image URLs). No database access here.
 *
 *   ADMIN_EVITE_COLUMNS      the `evites` row. NOT `render_claim` (an internal token).
 *   ADMIN_SEND_COLUMNS       the `evite_sends` ledger. NOT `provider_id`.
 *   ADMIN_CONTACT_PRESENCE_COLUMNS  read ONLY to compute "has a reminder contact" / "has a club
 *                            email". The raw values never reach the GET payload.
 *   ADMIN_REVEAL_COLUMNS     read ONLY by the logged `?reveal=<rsvpId>`.
 */

import { ogImageUrl, defaultOgImageUrl } from '@/lib/evites/pageModel'
import { screenForImage } from '@/lib/evites/glyphs'
import { TEMPLATE_SLUGS } from '@/lib/evites/templates'
import { EVITE_SEND_TYPES, type EviteSendRow, type EviteSendType } from '@/lib/evites/types'

export const ADMIN_EVITE_COLUMNS = [
  'id',
  'booking_id',
  'slug',
  'previous_slugs',
  'template_slug',
  'template_choice',
  'theme_word',
  'theme_sub',
  'host_contact_name',
  'host_contact_phone',
  'show_host_contact',
  'host_note',
  'gift_note',
  'rsvp_deadline',
  'render_version',
  'render_inputs_hash',
  'image_key',
  'invite_object',
  'og_object',
  'rendered_at',
  'render_error',
  'cal_version',
  'went_live_at',
  'cancelled_notice_at',
  'archived_at',
  'created_at',
  'updated_at',
] as const

export const ADMIN_SEND_COLUMNS = [
  'id',
  'rsvp_id',
  'send_type',
  'ref_version',
  'channel',
  'status',
  'attempts',
  'outcome',
  'last_error',
  'claimed_at',
  'sent_at',
] as const

export const ADMIN_CONTACT_PRESENCE_COLUMNS = ['id', 'reminder_email', 'reminder_phone_e164', 'club_email'] as const

/** What `void_rsvp` reads before it deletes: enough to audit WHAT was removed (no address) and to take a club member off the list. */
export const ADMIN_VOID_COLUMNS = ['id', 'evite_id', 'status', 'revision', 'child_count', 'club_email', 'club_opt_in_at', 'club_opted_out_at'] as const

export const ADMIN_REVEAL_COLUMNS =['id', 'evite_id', 'reminder_email', 'reminder_phone_e164', 'club_email'] as const

/** The most RSVP / send rows one GET reads. One more is requested so truncation is KNOWN, not guessed. */
export const ADMIN_ROW_LIMIT = 500
export const ADMIN_SEND_LIMIT = 2000

/** A `sending` row older than this has lost its worker. */
export const STUCK_SENDING_MS = 15 * 60 * 1000

/** UUID-shaped; used for the booking id in the URL and for `?reveal=`. */
export function isUuidLike(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

// ---------------------------------------------------------------- RSVP rows and the headcount

export interface AdminRsvpRow {
  id: string
  status: 'yes' | 'no'
  revision: number
  parent_name: string
  children: Array<{ first_name: string }>
  child_count: number
  adult_count: number
  has_allergy: boolean | null
  allergy_note: string | null
  note_to_honoree: string | null
  reminder_opt_out_at: string | null
  club_opt_in_at: string | null
  club_opted_out_at: string | null
  allergy_purged_at: string | null
  contacts_purged_at: string | null
  created_at: string
  updated_at: string
}

export interface ContactPresenceRow {
  id: string
  reminder_email: string | null
  reminder_phone_e164: string | null
  club_email: string | null
}

/** What the card gets for one RSVP: the allow-listed row plus two booleans. Never an address. */
export interface AdminRsvpView extends AdminRsvpRow {
  hasReminderContact: boolean
  hasClubEmail: boolean
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Build the card's rows. The output is built from `ADMIN_RSVP_COLUMNS`-shaped input
 * plus the presence booleans, so a select that grew a column cannot leak it:
 * the contact values are read into booleans here and dropped.
 */
export function adminRsvpViews(rows: readonly AdminRsvpRow[], presence: readonly ContactPresenceRow[], columns: readonly string[]): AdminRsvpView[] {
  const byId = new Map(presence.map((p) => [p.id, p]))
  return rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const col of columns) out[col] = (r as unknown as Record<string, unknown>)[col] ?? null
    const p = byId.get(r.id)
    out.hasReminderContact = !!p && (nonEmpty(p.reminder_email) || nonEmpty(p.reminder_phone_e164))
    out.hasClubEmail = !!p && nonEmpty(p.club_email)
    return out as unknown as AdminRsvpView
  })
}

export interface AllergyLine {
  parent: string
  children: string[]
  note: string | null
  /** The note existed and has been purged by retention; the flag is all that is left. */
  purged: boolean
}

export interface RsvpSummary {
  yesCount: number
  noCount: number
  kidsYes: number
  /** Sum of `adult_count`; `2` means "2+", so this is a floor when `adultsPlus` is true. */
  adultsYes: number
  adultsPlus: boolean
  cap: number | null
  overCap: boolean
  allergies: AllergyLine[]
  notes: Array<{ parent: string; note: string }>
  withReminderContact: number
}

function childNames(children: unknown): string[] {
  if (!Array.isArray(children)) return []
  return children
    .map((c) => (c && typeof c === 'object' && typeof (c as { first_name?: unknown }).first_name === 'string' ? (c as { first_name: string }).first_name : ''))
    .filter((n) => n.trim() !== '')
}

export function summarizeRsvps(rows: readonly AdminRsvpView[], cap: number | null): RsvpSummary {
  let yesCount = 0
  let noCount = 0
  let kidsYes = 0
  let adultsYes = 0
  let adultsPlus = false
  let withReminderContact = 0
  const allergies: AllergyLine[] = []
  const notes: Array<{ parent: string; note: string }> = []
  for (const r of rows) {
    if (typeof r.note_to_honoree === 'string' && r.note_to_honoree.trim() !== '') {
      notes.push({ parent: r.parent_name, note: r.note_to_honoree })
    }
    if (r.status === 'no') {
      noCount += 1
      continue
    }
    yesCount += 1
    kidsYes += Array.isArray(r.children) ? r.children.length : Number(r.child_count) || 0
    adultsYes += Number(r.adult_count) || 0
    if (Number(r.adult_count) >= 2) adultsPlus = true
    if (r.hasReminderContact) withReminderContact += 1
    const hasNote = typeof r.allergy_note === 'string' && r.allergy_note.trim() !== ''
    if (r.has_allergy === true || hasNote) {
      allergies.push({
        parent: r.parent_name,
        children: childNames(r.children),
        note: hasNote ? (r.allergy_note as string) : null,
        purged: !!r.allergy_purged_at,
      })
    }
  }
  return {
    yesCount,
    noCount,
    kidsYes,
    adultsYes,
    adultsPlus,
    cap,
    overCap: cap !== null && kidsYes > cap,
    allergies,
    notes,
    withReminderContact,
  }
}

// ---------------------------------------------------------------- the send ledger

export interface LedgerProblem {
  status: 'sending' | 'failed'
  rsvpId: string | null
  attempts: number
  claimedAt: string
  lastError: string | null
  outcome: string | null
}

export interface LedgerGroup {
  sendType: EviteSendType
  channel: 'email' | 'sms'
  counts: { sending: number; sent: number; failed: number; skipped: number }
  total: number
  /** The most recently CLAIMED row of the group. */
  latest: { status: EviteSendRow['status']; claimedAt: string; sentAt: string | null; outcome: string | null; lastError: string | null }
  /** `failed` rows, and `sending` rows older than 15 minutes. At most five are listed; `stuckCount` is the true figure. */
  problems: LedgerProblem[]
  stuckCount: number
}

type LedgerInput = Pick<EviteSendRow, 'rsvp_id' | 'send_type' | 'channel' | 'status' | 'attempts' | 'outcome' | 'last_error' | 'claimed_at' | 'sent_at'>

function ms(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** Counts by status per (send_type, channel), the latest row, and the failed / stuck ones. Ordered as spec §9.1. */
export function summarizeSends(rows: readonly LedgerInput[], now: Date): LedgerGroup[] {
  const groups = new Map<string, { g: LedgerGroup; latestAt: number }>()
  for (const r of rows) {
    const key = `${r.send_type}|${r.channel}`
    let entry = groups.get(key)
    const claimedMs = ms(r.claimed_at)
    if (!entry) {
      entry = {
        latestAt: -1,
        g: {
          sendType: r.send_type,
          channel: r.channel,
          counts: { sending: 0, sent: 0, failed: 0, skipped: 0 },
          total: 0,
          latest: { status: r.status, claimedAt: r.claimed_at, sentAt: r.sent_at, outcome: r.outcome, lastError: r.last_error },
          problems: [],
          stuckCount: 0,
        },
      }
      groups.set(key, entry)
    }
    const g = entry.g
    if (r.status in g.counts) g.counts[r.status] += 1
    g.total += 1
    if (claimedMs >= entry.latestAt) {
      entry.latestAt = claimedMs
      g.latest = { status: r.status, claimedAt: r.claimed_at, sentAt: r.sent_at, outcome: r.outcome, lastError: r.last_error }
    }
    const stuck = r.status === 'failed' || (r.status === 'sending' && now.getTime() - claimedMs > STUCK_SENDING_MS)
    if (stuck) {
      g.stuckCount += 1
      if (g.problems.length < 5) {
        g.problems.push({
          status: r.status === 'failed' ? 'failed' : 'sending',
          rsvpId: r.rsvp_id,
          attempts: r.attempts,
          claimedAt: r.claimed_at,
          lastError: r.last_error,
          outcome: r.outcome,
        })
      }
    }
  }
  const order = (t: EviteSendType): number => EVITE_SEND_TYPES.indexOf(t)
  return Array.from(groups.values())
    .map((e) => e.g)
    .sort((a, b) => order(a.sendType) - order(b.sendType) || a.channel.localeCompare(b.channel))
}

// ---------------------------------------------------------------- set_theme screening

export const THEME_FIELD_MAX = 12

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

export type ThemeTextResult = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * `theme_word` / `theme_sub`: null or '' clears the override; otherwise 1..12
 * characters (the migration's CHECK counts characters, not bytes) with no
 * control characters. The text is printed into an IMAGE, so a character its font
 * cannot draw is refused here rather than silently dropped at render time.
 */
export function screenThemeText(raw: unknown, font: 'monoton' | 'bungee', label: string): ThemeTextResult {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text` }
  if (hasControlChars(raw)) return { ok: false, error: `${label} contains control characters` }
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text === '') return { ok: true, value: null }
  const chars = Array.from(text).length
  if (chars < 1 || chars > THEME_FIELD_MAX) return { ok: false, error: `${label} must be 1 to ${THEME_FIELD_MAX} characters` }
  const printed = text.toLocaleUpperCase('en-US')
  if (screenForImage(printed, font) !== printed) return { ok: false, error: `${label} has a character the invitation font cannot draw` }
  return { ok: true, value: text }
}

export function isTemplateSlug(v: unknown): v is (typeof TEMPLATE_SLUGS)[number] {
  return typeof v === 'string' && (TEMPLATE_SLUGS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------- images and freshness

const IMAGE_KEY = /^[0-9a-f]{32}$/
const INVITE_OBJECT = /^invite-v\d{1,6}-[0-9a-f]{4}\.jpg$/

/** The stored portrait, or null when no render has landed (or the stored names are not what the renderer writes). */
export function inviteImageUrl(evite: { image_key: string | null; invite_object: string | null }, supabaseUrl: string | undefined): string | null {
  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base || !evite.image_key || !evite.invite_object) return null
  if (!IMAGE_KEY.test(evite.image_key) || !INVITE_OBJECT.test(evite.invite_object)) return null
  return `${base}/storage/v1/object/public/evites/${evite.image_key}/${evite.invite_object}`
}

/** The stored share card via the page's own builder, or null when it would be the static fallback. */
export function storedOgUrl(evite: { image_key: string | null; og_object: string | null }, supabaseUrl: string | undefined): string | null {
  const url = ogImageUrl(evite, supabaseUrl)
  return url === defaultOgImageUrl() ? null : url
}
