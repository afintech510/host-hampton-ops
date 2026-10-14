/**
 * What the HOST (the parent who booked) sees about their invitation (spec §7.2).
 *
 * One module behind three callers: `GET`/`PATCH /api/portal/invitation`, the server page
 * `/my-booking/invitation`, and the `share_clicked` beacon route. The routes answer with
 * `composeHostView(...).payload`; the page also takes `.facts` to draw the canvas.
 *
 *   readHostRows(supabase, bookingRef, now)   -> { kind: 'ok', loaded } | { kind: 'none' } | { kind: 'unavailable', reason }
 *   composeHostView(loaded, supabaseUrl, now) -> { payload, facts }        pure
 *   summarizeRsvps(rsvps, cap)                -> HostSummary                pure
 *   findEviteIdForRef(supabase, bookingRef)   -> { kind: 'ok', eviteId } | { kind: 'none' } | { kind: 'unavailable' }
 *
 * THREE OUTCOMES, never a bare null (AGENTS.md rule 12). `none` is "this booking has no
 * invitation the host may see": the pages flag is off (or `pilot` and this is not a pilot
 * booking), there is no evite yet, it is archived, or the booking is cancelled/lost. A failed
 * read is `unavailable` and becomes a 503 - never a 404 ("you have no invitation") and never a
 * wrong state (a payments read that failed must not read as "not booked").
 *
 * NOTHING HERE CREATES AN EVITE. `ensureEviteForBooking` belongs to the intake routes and the
 * cron; a GET that created rows would turn every portal page view into a write.
 *
 * COLUMN DISCIPLINE. Every read names its columns. The RSVP read is `HOST_RSVP_COLUMNS` and
 * `pickHostRsvp` re-picks exactly those keys, so even a row object that carried more (a fake in
 * a test, a future `select`) cannot leak the reminder email or phone, the club fields, the
 * consent IP, `edit_nonce`, `id` or `evite_id`. The payload carries neither the evite's id nor
 * `render_*` bookkeeping: the host gets `url` (which holds the slug, a capability they already
 * hold) and two image URLs.
 *
 * The bucket name is spelled here as a literal so the PAGE bundle does not import `render.ts`
 * (sharp, satori); a test pins it equal to `EVITE_BUCKET`.
 */

import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { etDateString } from '@/lib/partyTime'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { inviteFacts, type InviteFacts } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { honoreeFirstName } from '@/lib/evites/pageModel'
import { inviteState, type InviteState } from '@/lib/evites/state'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import { galleryTemplates, isGallerySlug, sampleImageOf } from '@/lib/evites/templates'
import type { EviteBookingRow, EviteLineItemRow, EvitePaymentRow, EviteRow, EviteRsvpRow, PartyThemeRow } from '@/lib/evites/types'
import { EVITE_BOOKING_COLUMNS, EVITE_PAGE_COLUMNS, EVITE_PAYMENT_COLUMNS, HOST_RSVP_COLUMNS } from '@/lib/evites/views'

type Supa = ReturnType<typeof getSupabase>

/** Mirrors `EVITE_BUCKET` in render.ts (asserted equal by a test). */
export const HOST_IMAGE_BUCKET = 'evites'

/**
 * The `evites` columns the host view reads: what the public page reads, plus the hash the
 * freshness check compares. Declared here rather than in views.ts (parallel work owns that file).
 */
export const HOST_EVITE_COLUMNS = [...EVITE_PAGE_COLUMNS, 'render_inputs_hash'] as const

export type HostEviteRow = Pick<EviteRow, (typeof HOST_EVITE_COLUMNS)[number]>
export type HostRsvp = Pick<EviteRsvpRow, (typeof HOST_RSVP_COLUMNS)[number]>

/** States the host can be shown a page for. */
export type HostVisibleState = Exclude<InviteState, 'disabled' | 'unavailable'>

export interface HostLoaded {
  evite: HostEviteRow
  booking: EviteBookingRow
  lineItems: EviteLineItemRow[]
  partyThemes: PartyThemeRow[]
  state: HostVisibleState
  rsvps: HostRsvp[]
}

export type HostRead = { kind: 'ok'; loaded: HostLoaded } | { kind: 'none' } | { kind: 'unavailable'; reason: string }

const NONE: HostRead = { kind: 'none' }

function pagesVisibleFor(bookingRef: string): boolean {
  const mode = evitePagesMode()
  if (mode === 'off') return false
  if (mode === 'pilot' && !isPilotBooking(bookingRef)) return false
  return true
}

const unavailable = (what: string, message: string): HostRead => ({ kind: 'unavailable', reason: `${what} read failed: ${message}` })

export async function readHostRows(supabase: Supa, bookingRef: string, now: Date = new Date()): Promise<HostRead> {
  // The flag answers before any read: a switched-off feature costs the portal nothing.
  if (!pagesVisibleFor(bookingRef)) return NONE

  const bk = await supabase.from('bookings').select(EVITE_BOOKING_COLUMNS.join(', ')).eq('booking_ref', bookingRef).maybeSingle<EviteBookingRow>()
  if (bk.error) return unavailable('bookings', bk.error.message)
  const booking = bk.data
  if (!booking) return NONE

  const ev = await supabase.from('evites').select(HOST_EVITE_COLUMNS.join(', ')).eq('booking_id', booking.id).maybeSingle<HostEviteRow>()
  if (ev.error) return unavailable('evites', ev.error.message)
  const evite = ev.data
  if (!evite) return NONE
  if (evite.archived_at) return NONE

  // A failed payments read must not become "no payments", which inviteState reads as preview.
  const pay = await supabase.from('booking_payments').select(EVITE_PAYMENT_COLUMNS.join(', ')).eq('booking_id', booking.id)
  if (pay.error) return unavailable('booking_payments', pay.error.message)
  const payments = (pay.data ?? []) as unknown as EvitePaymentRow[]

  const themes = await readThemeInputs(supabase, booking.id)
  if (themes.kind === 'unavailable') return { kind: 'unavailable', reason: themes.reason }

  const state = inviteState(booking, payments, evite, now, {
    pagesMode: evitePagesMode(),
    isPilot: isPilotBooking(booking.booking_ref),
  })
  if (state === 'disabled' || state === 'unavailable') return NONE

  const rs = await supabase
    .from('evite_rsvps')
    .select(HOST_RSVP_COLUMNS.join(', '))
    .eq('evite_id', evite.id)
    .order('created_at', { ascending: true })
  if (rs.error) return unavailable('evite_rsvps', rs.error.message)
  const rsvps = ((rs.data ?? []) as unknown as Array<Record<string, unknown>>).map(pickHostRsvp)

  return { kind: 'ok', loaded: { evite, booking, lineItems: themes.lineItems, partyThemes: themes.partyThemes, state, rsvps } }
}

/** For the beacon route: flag, booking, evite - and nothing else read. */
export type EviteIdRead = { kind: 'ok'; eviteId: string } | { kind: 'none' } | { kind: 'unavailable'; reason: string }

export async function findEviteIdForRef(supabase: Supa, bookingRef: string): Promise<EviteIdRead> {
  if (!pagesVisibleFor(bookingRef)) return { kind: 'none' }
  const bk = await supabase.from('bookings').select('id').eq('booking_ref', bookingRef).maybeSingle<{ id: string }>()
  if (bk.error) return { kind: 'unavailable', reason: `bookings read failed: ${bk.error.message}` }
  if (!bk.data) return { kind: 'none' }
  const ev = await supabase.from('evites').select('id, archived_at').eq('booking_id', bk.data.id).maybeSingle<{ id: string; archived_at: string | null }>()
  if (ev.error) return { kind: 'unavailable', reason: `evites read failed: ${ev.error.message}` }
  if (!ev.data || ev.data.archived_at) return { kind: 'none' }
  return { kind: 'ok', eviteId: ev.data.id }
}

// ---------------------------------------------------------------- the RSVP list and its summary

/** Exactly `HOST_RSVP_COLUMNS`, whatever the row object carries. */
export function pickHostRsvp(r: Record<string, unknown>): HostRsvp {
  const kids = Array.isArray(r.children) ? r.children : []
  return {
    status: r.status === 'no' ? 'no' : 'yes',
    parent_name: typeof r.parent_name === 'string' ? r.parent_name : '',
    children: kids
      .map((c) => (c && typeof c === 'object' ? (c as { first_name?: unknown }).first_name : null))
      .filter((n): n is string => typeof n === 'string' && n !== '')
      .map((first_name) => ({ first_name })),
    adult_count: r.adult_count === 2 ? 2 : r.adult_count === 1 ? 1 : 0,
    has_allergy: typeof r.has_allergy === 'boolean' ? r.has_allergy : null,
    allergy_note: typeof r.allergy_note === 'string' ? r.allergy_note : null,
    note_to_honoree: typeof r.note_to_honoree === 'string' ? r.note_to_honoree : null,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  }
}

export interface HostAllergy {
  parent: string
  children: string[]
  note: string | null
}

export interface HostSummary {
  /** Sum of `child_count` over the YES answers. The birthday child is not an RSVP, so is never in it. */
  kidsYes: number
  /** Sum of `adult_count` over the YES answers, where the stored 2 means "2+" and counts as 2. */
  adultsYes: number
  /** True when any yes answer said "2+": `adultsYes` is then a floor. */
  adultsPlus: boolean
  noCount: number
  /** `bookings.guest_count_approx`, or null. */
  cap: number | null
  allergies: HostAllergy[]
}

export function summarizeRsvps(rsvps: readonly HostRsvp[], cap: number | null): HostSummary {
  let kidsYes = 0
  let adultsYes = 0
  let adultsPlus = false
  let noCount = 0
  const allergies: HostAllergy[] = []
  for (const r of rsvps) {
    if (r.status === 'no') {
      noCount += 1
      continue
    }
    kidsYes += r.children.length
    adultsYes += r.adult_count
    if (r.adult_count === 2) adultsPlus = true
    if (r.has_allergy === true) {
      allergies.push({ parent: r.parent_name, children: r.children.map((c) => c.first_name), note: r.allergy_note })
    }
  }
  return { kidsYes, adultsYes, adultsPlus, noCount, cap, allergies }
}

// ---------------------------------------------------------------- images and freshness

const IMAGE_KEY = /^[0-9a-f]{32}$/
const INVITE_OBJECT = /^invite-v\d{1,6}-[0-9a-f]{4}\.jpg$/
const OG_OBJECT = /^og-v\d{1,6}-[0-9a-f]{4}\.jpg$/

/** `<supabase>/storage/v1/object/public/evites/<image_key>/<object>`, or null when anything is missing or malformed. */
export function storedImageUrl(
  evite: Pick<HostEviteRow, 'image_key' | 'invite_object' | 'og_object'>,
  which: 'invite' | 'og',
  supabaseUrl: string | undefined,
): string | null {
  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  const object = which === 'invite' ? evite.invite_object : evite.og_object
  if (!base || !evite.image_key || !object) return null
  if (!IMAGE_KEY.test(evite.image_key) || !(which === 'invite' ? INVITE_OBJECT : OG_OBJECT).test(object)) return null
  return `${base}/storage/v1/object/public/${HOST_IMAGE_BUCKET}/${evite.image_key}/${object}`
}

/** Both images exist AND what they were drawn from is what the invitation says now (spec §7.2). */
export function isRenderFresh(
  evite: Pick<HostEviteRow, 'image_key' | 'invite_object' | 'og_object' | 'render_inputs_hash'>,
  facts: InviteFacts,
  supabaseUrl: string | undefined,
): boolean {
  if (storedImageUrl(evite, 'invite', supabaseUrl) === null || storedImageUrl(evite, 'og', supabaseUrl) === null) return false
  return evite.render_inputs_hash !== null && evite.render_inputs_hash === renderInputsHash(facts)
}

// ---------------------------------------------------------------- the payload

/** The display subset of `InviteFacts` the host page shows or shares. */
export interface HostFactsView {
  title: string
  /** 'Mia', or null when the booking has no name yet. */
  honoreeName: string | null
  dateLine: string
  shortDateLine: string
  placeLine: string
  hostContactLine: string | null
  hostNote: string | null
  giftNote: string | null
  rsvpDeadline: string | null
  guestCap: number | null
  shareText: string
  reshareText: string
}

export interface HostCustomize {
  host_note: string | null
  gift_note: string | null
  rsvp_deadline: string | null
  show_host_contact: boolean
  host_contact_name: string | null
  host_contact_phone: string | null
}

/** One design in the host's gallery. */
export interface HostDesignOption {
  slug: string
  label: string
  /** The sample render ("Mia's 7th"), a public path. */
  sample: string
}

/** The design picker (migration 070). */
export interface HostDesign {
  /** The design the invitation is drawn with now. */
  current: string
  /** The host's stored pick, or null when the theme's design is in use. */
  choice: string | null
  options: HostDesignOption[]
}

export interface HostPayload {
  state: HostVisibleState
  facts: HostFactsView
  url: string
  images: { invite: string | null; og: string | null }
  renderFresh: boolean
  rsvps: HostRsvp[]
  summary: HostSummary
  customize: HostCustomize
  /** The RSVP-by date input's bounds: today (ET) ... the party date (null when there is none). */
  deadlineRange: { min: string; max: string | null }
  /** Null when the party has its own art (migration 073, `custom_art`): no picker is offered. */
  design: HostDesign | null
}

export function composeHostView(loaded: HostLoaded, supabaseUrl: string | undefined, now: Date = new Date()): { payload: HostPayload; facts: InviteFacts } {
  const { evite, booking, state } = loaded
  const facts = inviteFacts(booking, evite, loaded.lineItems, loaded.partyThemes, state)
  const payload: HostPayload = {
    state,
    facts: {
      title: facts.title,
      honoreeName: honoreeFirstName(facts),
      dateLine: facts.dateLine,
      shortDateLine: facts.shortDateLine,
      placeLine: facts.placeLine,
      hostContactLine: facts.hostContactLine,
      hostNote: facts.hostNote,
      giftNote: facts.giftNote,
      rsvpDeadline: facts.rsvpDeadline,
      guestCap: facts.guestCap,
      shareText: facts.shareText,
      reshareText: facts.reshareText,
    },
    url: `${CANONICAL_ORIGIN}/i/${evite.slug}`,
    images: { invite: storedImageUrl(evite, 'invite', supabaseUrl), og: storedImageUrl(evite, 'og', supabaseUrl) },
    renderFresh: isRenderFresh(evite, facts, supabaseUrl),
    rsvps: loaded.rsvps,
    summary: summarizeRsvps(loaded.rsvps, facts.guestCap),
    customize: {
      host_note: evite.host_note,
      gift_note: evite.gift_note,
      rsvp_deadline: validPartyDate(evite.rsvp_deadline),
      show_host_contact: evite.show_host_contact !== false,
      host_contact_name: evite.host_contact_name,
      host_contact_phone: evite.host_contact_phone,
    },
    deadlineRange: { min: etDateString(now), max: validPartyDate(booking.party_date) },
    // The party's own art outranks any pick (facts.ts), so a picker would offer choices that change nothing.
    design: facts.customArt
      ? null
      : {
          current: facts.templateSlug,
          choice: isGallerySlug(evite.template_choice) ? evite.template_choice : null,
          options: galleryTemplates().map((t) => ({ slug: t.slug, label: t.label as string, sample: sampleImageOf(t.slug) })),
        },
  }
  return { payload, facts }
}
