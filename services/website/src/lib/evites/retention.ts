/**
 * Retention for invitation data (spec §12, §13): cron step 8.
 *
 *   party_date + 7 d    allergy_note -> NULL, allergy_purged_at          (a child's health detail)
 *   party_date + 30 d   non-club RSVPs: reminder email / phone and consent_ip -> NULL, contacts_purged_at;
 *                       then the evite is ARCHIVED (the page stops answering, the child's name leaves the web)
 *   never booked        a `preview` evite 60 days after it was made, or once its party date has passed -> archived
 *   club opt-ins        KEEP their consent fields (club_email, club_opt_in_at, opt_in_text_version, consent_ip,
 *                       birthday_month): the RSVP row is the consent record until the guest opts out
 *
 * WHEN IT RUNS. Whenever `EVITES_PAGES` is not `off` - NOT gated by `EVITES_SENDS`. Retention is data
 * hygiene, not an email: switching the emails off must not keep a child's allergy note past the promise
 * we made about it. (With pages off there is no feature in service, and this does nothing; a pilot only
 * touches the pilot bookings.) That is this module's reading of "the flags gate steps 4-9's SENDS"; the
 * orchestrator can overrule it, and the one place to do it is `runEviteSendsTick`.
 *
 * "CLUB" is `club_opt_in_at IS NOT NULL AND club_opted_out_at IS NULL`. A guest who opted OUT is no longer
 * a club member, so their reminder contacts are purged on the same +30 d schedule; their consent record
 * (the opt-in and the withdrawal) is deliberately left, because it is the evidence of what they agreed to
 * and when they stopped.
 *
 * Every read is three-outcome (a failed read is an error, never "nothing to purge"), every write reads its
 * `{error}` and is conditional on the row not already being purged, and every dated decision uses the
 * Eastern calendar day (`etDateString`/`shiftEtDate`): the box is UTC.
 *
 * The report is COUNTS ONLY. Nothing here logs a name, an address or a ref.
 */

import type { getSupabase } from '@/lib/supabase'
import { etDateString, shiftEtDate } from '@/lib/partyTime'
import { bookingStage } from '@/lib/bookingStatus'
import { DAY_MS } from '@/lib/rateLimit'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { dayOnOrAfter } from '@/lib/evites/cronDue'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { loadSendContext } from '@/lib/evites/sendContext'

type Supa = ReturnType<typeof getSupabase>

export const ALLERGY_PURGE_DAYS = 7
export const CONTACTS_PURGE_DAYS = 30
export const DEAD_LEAD_DAYS = 60
/** PostgREST refuses an `.in()` list past ~390 uuids; stay well under it. */
export const IN_CHUNK = 100
export const RSVP_SCAN = 500
export const EVITE_SCAN = 500
/** Contexts loaded per tick to decide whether a stale lead is really unbooked. */
export const DEAD_LEAD_CHECKS = 25
export const ARCHIVES_PER_TICK = 50

export interface RetentionReport {
  allergyPurged: number
  contactsPurged: number
  archivedAfterParty: number
  archivedDeadLead: number
  /** After-party archives held back because an RSVP of that evite still had contacts to purge. */
  archiveDeferred: number
  errors: number
}

export const emptyRetentionReport = (): RetentionReport => ({
  allergyPurged: 0,
  contactsPurged: 0,
  archivedAfterParty: 0,
  archivedDeadLead: 0,
  archiveDeferred: 0,
  errors: 0,
})

export function chunks<T>(xs: readonly T[], n: number = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

interface BookingInfo {
  ref: string | null
  status: string | null
  partyDate: string | null
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** evite id -> its booking's ref, status and party date. `null` when any read failed (the caller counts the error and stops). */
async function bookingInfoByEvite(supabase: Supa, eviteIds: readonly string[]): Promise<Map<string, BookingInfo> | null> {
  const bookingOf = new Map<string, string>()
  for (const part of chunks(eviteIds)) {
    const r = await supabase.from('evites').select('id, booking_id').in('id', part)
    if (r.error) {
      console.error(`evites/retention: evites read failed: ${r.error.message}`)
      return null
    }
    for (const row of (r.data ?? []) as unknown as Array<{ id: string; booking_id: string }>) bookingOf.set(row.id, row.booking_id)
  }
  const infoOf = new Map<string, BookingInfo>()
  for (const part of chunks(Array.from(new Set(bookingOf.values())))) {
    const r = await supabase.from('bookings').select('id, booking_ref, status, party_date').in('id', part)
    if (r.error) {
      console.error(`evites/retention: bookings read failed: ${r.error.message}`)
      return null
    }
    for (const row of (r.data ?? []) as unknown as Array<{ id: string; booking_ref: string | null; status: string | null; party_date: string | null }>) {
      infoOf.set(row.id, { ref: row.booking_ref, status: row.status, partyDate: validPartyDate(row.party_date) })
    }
  }
  const out = new Map<string, BookingInfo>()
  for (const [eviteId, bookingId] of Array.from(bookingOf.entries())) {
    const info = infoOf.get(bookingId)
    if (info) out.set(eviteId, info)
  }
  return out
}

export async function runRetention(supabase: Supa, opts: { now: Date }): Promise<RetentionReport> {
  const rep = emptyRetentionReport()
  const mode = evitePagesMode()
  if (mode === 'off') return rep
  const now = opts.now
  const nowIso = now.toISOString()
  const today = etDateString(now)
  const allowed = (info: BookingInfo | undefined): info is BookingInfo => !!info && (mode === 'on' || isPilotBooking(info.ref))

  try {
    await purgeAllergies(supabase, rep, { today, nowIso, allowed })
    await purgeContacts(supabase, rep, { today, nowIso, allowed })
    await archiveEvites(supabase, rep, { now, today, nowIso, allowed })
  } catch (e) {
    rep.errors += 1
    console.error(`evites/retention: threw: ${describe(e)}`)
  }
  return rep
}

interface Ctx {
  today: string
  nowIso: string
  allowed: (info: BookingInfo | undefined) => info is BookingInfo
}

/** party_date + 7 d: the allergy note goes. */
async function purgeAllergies(supabase: Supa, rep: RetentionReport, c: Ctx): Promise<void> {
  const found = await supabase
    .from('evite_rsvps')
    .select('id, evite_id')
    .not('allergy_note', 'is', null)
    .is('allergy_purged_at', null)
    .order('created_at', { ascending: true })
    .limit(RSVP_SCAN)
  if (found.error) {
    rep.errors += 1
    console.error(`evites/retention: allergy read failed: ${found.error.message}`)
    return
  }
  const rows = (found.data ?? []) as unknown as Array<{ id: string; evite_id: string }>
  if (rows.length === 0) return
  const info = await bookingInfoByEvite(supabase, Array.from(new Set(rows.map((r) => r.evite_id))))
  if (!info) {
    rep.errors += 1
    return
  }
  const due = rows.filter((r) => {
    const b = info.get(r.evite_id)
    return c.allowed(b) && b.partyDate !== null && dayOnOrAfter(c.today, b.partyDate, ALLERGY_PURGE_DAYS)
  })
  for (const part of chunks(due.map((r) => r.id))) {
    const done = await supabase
      .from('evite_rsvps')
      .update({ allergy_note: null, allergy_purged_at: c.nowIso })
      .in('id', part)
      .is('allergy_purged_at', null)
      .select('id')
    if (done.error) {
      rep.errors += 1
      console.error(`evites/retention: allergy purge failed: ${done.error.message}`)
      continue
    }
    rep.allergyPurged += ((done.data ?? []) as unknown[]).length
  }
}

/** party_date + 30 d: reminder contacts (and, for a non-club guest, the consent IP) go. Club opt-ins keep their consent fields. */
async function purgeContacts(supabase: Supa, rep: RetentionReport, c: Ctx): Promise<void> {
  const plain = await supabase
    .from('evite_rsvps')
    .select('id, evite_id')
    .is('contacts_purged_at', null)
    .is('club_opt_in_at', null)
    .order('created_at', { ascending: true })
    .limit(RSVP_SCAN)
  const optedOut = await supabase
    .from('evite_rsvps')
    .select('id, evite_id')
    .is('contacts_purged_at', null)
    .not('club_opt_in_at', 'is', null)
    .not('club_opted_out_at', 'is', null)
    .order('created_at', { ascending: true })
    .limit(RSVP_SCAN)
  for (const r of [plain, optedOut]) {
    if (r.error) {
      rep.errors += 1
      console.error(`evites/retention: contacts read failed: ${r.error.message}`)
    }
  }
  const plainRows = plain.error ? [] : ((plain.data ?? []) as unknown as Array<{ id: string; evite_id: string }>)
  const outRows = optedOut.error ? [] : ((optedOut.data ?? []) as unknown as Array<{ id: string; evite_id: string }>)
  if (plainRows.length + outRows.length === 0) return

  const info = await bookingInfoByEvite(supabase, Array.from(new Set([...plainRows, ...outRows].map((r) => r.evite_id))))
  if (!info) {
    rep.errors += 1
    return
  }
  const due = (rows: typeof plainRows) =>
    rows
      .filter((r) => {
        const b = info.get(r.evite_id)
        return c.allowed(b) && b.partyDate !== null && dayOnOrAfter(c.today, b.partyDate, CONTACTS_PURGE_DAYS)
      })
      .map((r) => r.id)

  for (const part of chunks(due(plainRows))) {
    const done = await supabase
      .from('evite_rsvps')
      .update({ reminder_email: null, reminder_phone_e164: null, consent_ip: null, contacts_purged_at: c.nowIso })
      .in('id', part)
      .is('contacts_purged_at', null)
      // Re-stated in the write: a guest who joined the club between the read and now keeps their record.
      .is('club_opt_in_at', null)
      .select('id')
    if (done.error) {
      rep.errors += 1
      console.error(`evites/retention: contacts purge failed: ${done.error.message}`)
      continue
    }
    rep.contactsPurged += ((done.data ?? []) as unknown[]).length
  }
  for (const part of chunks(due(outRows))) {
    const done = await supabase
      .from('evite_rsvps')
      // The opt-in and the withdrawal are the record of what they agreed to: consent_ip stays.
      .update({ reminder_email: null, reminder_phone_e164: null, contacts_purged_at: c.nowIso })
      .in('id', part)
      .is('contacts_purged_at', null)
      .not('club_opted_out_at', 'is', null)
      .select('id')
    if (done.error) {
      rep.errors += 1
      console.error(`evites/retention: contacts purge (opted-out) failed: ${done.error.message}`)
      continue
    }
    rep.contactsPurged += ((done.data ?? []) as unknown[]).length
  }
}

/** Does this evite still have a guest whose reminder contacts are waiting to be purged? A failed read says yes. */
async function hasUnpurgedGuests(supabase: Supa, eviteId: string): Promise<boolean> {
  const r = await supabase
    .from('evite_rsvps')
    .select('id, club_opt_in_at, club_opted_out_at')
    .eq('evite_id', eviteId)
    .is('contacts_purged_at', null)
    .limit(RSVP_SCAN)
  if (r.error) {
    console.error(`evites/retention: remaining-guests read failed: ${r.error.message}`)
    return true
  }
  const rows = (r.data ?? []) as unknown as Array<{ club_opt_in_at: string | null; club_opted_out_at: string | null }>
  // A current club member is never purged here, so they do not hold the archive back.
  return rows.some((g) => g.club_opt_in_at === null || g.club_opted_out_at !== null)
}

async function archive(supabase: Supa, rep: RetentionReport, eviteId: string, nowIso: string): Promise<boolean> {
  const done = await supabase.from('evites').update({ archived_at: nowIso }).eq('id', eviteId).is('archived_at', null).select('id')
  if (done.error) {
    rep.errors += 1
    console.error(`evites/retention: archive failed: ${done.error.message}`)
    return false
  }
  return ((done.data ?? []) as unknown[]).length > 0
}

/** +30 d after the party, or a dead lead at +60 d / once its date has passed: the page goes away. */
async function archiveEvites(supabase: Supa, rep: RetentionReport, c: Ctx & { now: Date }): Promise<void> {
  const list = await supabase
    .from('evites')
    .select('id, created_at')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(EVITE_SCAN)
  if (list.error) {
    rep.errors += 1
    console.error(`evites/retention: evites read failed: ${list.error.message}`)
    return
  }
  const evites = (list.data ?? []) as unknown as Array<{ id: string; created_at: string }>
  if (evites.length === 0) return
  const info = await bookingInfoByEvite(supabase, evites.map((e) => e.id))
  if (!info) {
    rep.errors += 1
    return
  }

  let archives = 0
  let deadChecks = 0
  for (const ev of evites) {
    if (archives >= ARCHIVES_PER_TICK) break
    const b = info.get(ev.id)
    if (!c.allowed(b)) continue

    // ---- after the party
    if (b.partyDate !== null && dayOnOrAfter(c.today, b.partyDate, CONTACTS_PURGE_DAYS)) {
      if (await hasUnpurgedGuests(supabase, ev.id)) {
        rep.archiveDeferred += 1
        continue
      }
      if (await archive(supabase, rep, ev.id, c.nowIso)) {
        rep.archivedAfterParty += 1
        archives += 1
      }
      continue
    }

    // ---- a dead lead: never booked, and either 60 days old or its date has gone by
    const stale = Date.parse(ev.created_at) + DEAD_LEAD_DAYS * DAY_MS <= c.now.getTime()
    const passed = b.partyDate !== null && b.partyDate < c.today
    if (!stale && !passed) continue
    // A status that only a booked (or cancelled) party carries can never be `preview`: skip it without a read.
    const stage = bookingStage({ status: b.status, paidCents: 0, partyDate: b.partyDate, today: c.today })
    if (stage !== 'inquiry' && stage !== 'quoted') continue
    if (deadChecks >= DEAD_LEAD_CHECKS) continue
    deadChecks += 1
    const read = await loadSendContext(supabase, ev.id, null, c.now)
    if (read.kind === 'unavailable') {
      rep.errors += 1
      continue
    }
    if (read.kind !== 'ok' || read.ctx.state !== 'preview') continue
    if (await archive(supabase, rep, ev.id, c.nowIso)) {
      rep.archivedDeadLead += 1
      archives += 1
    }
  }
}

/** Exposed for the tests: the first Eastern date each rule applies on. */
export function retentionDates(partyDate: string): { allergy: string; contacts: string } {
  return { allergy: shiftEtDate(partyDate, ALLERGY_PURGE_DAYS), contacts: shiftEtDate(partyDate, CONTACTS_PURGE_DAYS) }
}
