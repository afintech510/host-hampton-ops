import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eviteRsvpRule, eviteViewRule, guardRate } from '@/lib/rateLimit'
import { resolveEviteBySlug, type ResolveOutcome } from '@/lib/evites/resolve'
import { recordEviteEvent } from '@/lib/evites/analytics'
import { readCurrentClubConsent } from '@/lib/evites/consent'
import { fireClubOptIn, fireClubOptOut } from '@/lib/evites/clubHook'
import { fireRsvpHook } from '@/lib/evites/rsvpHooks'
import { cookieName, editTokenExpiry, newEditNonce, signEditToken, verifyEditToken } from '@/lib/evites/rsvpToken'
import { decideClubOptIn, screenRsvpPatch, screenRsvpPost, type ExistingRsvp } from '@/lib/evites/screens'
import { OWN_RSVP_SELECT, ownRsvpView } from '@/lib/evites/rsvpView'
import {
  REMINDER_EMAIL_DAILY_CAP,
  REMINDER_EMAIL_PER_EVITE_CAP,
  RSVP_BODY_MAX_CHARS,
  consentIp,
  honeypotRsvp,
  originAllowed,
  rsvpCap,
  setRsvpCookie,
} from '@/lib/evites/rsvpHttp'

/**
 * The guest RSVP API (spec §7.5). Public, unauthenticated: the credential for a
 * change is the signed edit token (cookie or `x-rsvp-token`), for a create it is
 * the slug.
 *
 *   POST   screens 1-2: create an answer, set the edit cookie, answer with THIS row only
 *   PATCH  screen 3 and edits: change it, add the note, tick the club box, stop reminders
 *
 * GATE ORDER (spec §7.5): rate limit -> Origin -> resolve -> live and before the
 * start -> honeypot -> per-evite cap (POST only). The rate limiter is the first
 * statement, before anything is awaited.
 *
 * Every unavailable invitation (unknown, archived, cancelled, switched off, an old
 * alias) is the same 404. A read error is a 500/503, never a 404 and never "closed".
 *
 * A response carries ONE RSVP, the caller's own, reduced to PUBLIC_RSVP_SELF_COLUMNS
 * by `ownRsvpView`. `id` / `evite_id` are never read from the body.
 *
 * Emails are NOT sent here: `rsvpHooks` (P09) and the club hooks (`lib/evites/club.ts`, P10) are fired
 * without being awaited.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: { slug: string } }
type Ok = Extract<ResolveOutcome, { kind: 'ok' }>

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

const GENERIC_FAILURE = { error: 'We couldn’t save that just now. Please try again in a moment.' }

type Gate =
  | { ok: true; resolved: Ok; body: unknown; now: Date }
  | { ok: false; res: NextResponse }

/**
 * Gates 3-5: resolve, live and before the start, then the body and the honeypot.
 * The honeypot answer is returned as a `res` so neither handler can write after it.
 */
async function openGate(req: NextRequest, slug: string): Promise<Gate> {
  const now = new Date()

  let resolved: ResolveOutcome
  try {
    resolved = await resolveEviteBySlug(getSupabase(), slug, { now })
  } catch (e) {
    console.error(`api/i/rsvp: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, res: json({ error: 'Something went wrong' }, 500) }
  }
  // 'redirect' (an old slug) is a 404 here as on the beacon: the page 308s and the new page posts to the new slug.
  if (resolved.kind !== 'ok') return { ok: false, res: json({ error: 'Not found' }, 404) }

  const win = resolved.facts.window
  if (resolved.state !== 'live' || !win || now.getTime() >= win.startUtc.getTime()) {
    return { ok: false, res: json({ error: 'closed' }, 409) }
  }

  let body: unknown
  try {
    const text = await req.text()
    if (text.length > RSVP_BODY_MAX_CHARS) return { ok: false, res: json({ error: 'Invalid request' }, 413) }
    body = JSON.parse(text)
  } catch {
    return { ok: false, res: json({ error: 'Invalid request' }, 400) }
  }

  const trap = body && typeof body === 'object' ? (body as Record<string, unknown>).website : undefined
  if (typeof trap === 'string' && trap.trim() !== '') {
    return { ok: false, res: json({ ok: true, rsvp: honeypotRsvp(body, now), calendarUrl: `/i/${slug}/cal` }) }
  }

  return { ok: true, resolved, body, now }
}

/**
 * The DB-backed per-recipient caps (spec §7.5, v1.2). True when the address may be kept as a reminder
 * address: fewer than `REMINDER_EMAIL_DAILY_CAP` RSVPs anywhere SET it in the last 24 hours (`reminder_set_at`,
 * so setting it by PATCH on an old row counts), and fewer than `REMINDER_EMAIL_PER_EVITE_CAP` RSVPs on THIS
 * invitation hold it. Used by BOTH the POST and any PATCH that sets or changes the address: there is no
 * path that stores a reminder address without passing here. An RPC error is NOT "zero recent": it fails
 * toward not emailing a stranger.
 */
async function reminderEmailAllowed(supabase: ReturnType<typeof getSupabase>, eviteId: string, email: string): Promise<boolean> {
  const recent = await supabase.rpc('evite_reminder_email_recent', { p_email: email })
  if (recent.error || typeof recent.data !== 'number') {
    console.error(`api/i/rsvp: evite_reminder_email_recent failed, storing the RSVP without the reminder address: ${recent.error?.message ?? 'non-numeric result'}`)
    return false
  }
  if (recent.data >= REMINDER_EMAIL_DAILY_CAP) return false
  const here = await supabase.rpc('evite_reminder_email_on_evite', { p_evite_id: eviteId, p_email: email })
  if (here.error || typeof here.data !== 'number') {
    console.error(`api/i/rsvp: evite_reminder_email_on_evite failed, storing the RSVP without the reminder address: ${here.error?.message ?? 'non-numeric result'}`)
    return false
  }
  return here.data < REMINDER_EMAIL_PER_EVITE_CAP
}

export async function POST(req: NextRequest, { params }: Params) {
  // The shared page/beacon/cal ceiling first: this route also answers 404 for an unknown slug, so without it
  // it is a second, more generously limited, enumeration oracle (v1.2). Then the RSVP's own tighter rule.
  const viewLimited = guardRate(req, eviteViewRule)
  if (viewLimited) return viewLimited
  const limited = guardRate(req, eviteRsvpRule)
  if (limited) return limited
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, 403)

  const gate = await openGate(req, params.slug)
  if (!gate.ok) return gate.res
  const { resolved, body, now } = gate
  const supabase = getSupabase()
  const eviteId = resolved.evite.id

  // Gate 6: the per-evite cap. A failed count is not "zero".
  const count = await supabase.from('evite_rsvps').select('id', { count: 'exact', head: true }).eq('evite_id', eviteId)
  if (count.error || typeof count.count !== 'number') {
    console.error(`api/i/rsvp: count failed: ${count.error?.message ?? 'no count'}`)
    return json(GENERIC_FAILURE, 503)
  }
  if (count.count >= rsvpCap(resolved.facts.guestCap)) return json({ error: 'This list is full — please contact the host' }, 429)

  const screened = screenRsvpPost(body)
  if (!screened.ok) return json({ error: screened.message, field: screened.field }, 400)
  const v = screened.value

  let reminderEmail: string | null = null
  let reminderPhone: string | null = null
  let reminderDropped = false
  if (v.reminder.kind === 'email') {
    if (await reminderEmailAllowed(supabase, eviteId, v.reminder.email)) reminderEmail = v.reminder.email
    else reminderDropped = true
  } else if (v.reminder.kind === 'phone') {
    reminderPhone = v.reminder.phoneE164
  }

  // The id is minted here so the edit token exists BEFORE the row does: if signing is impossible
  // (no secret in production) nothing has been written, instead of a row nobody can edit.
  const id = randomUUID()
  const editNonce = newEditNonce()
  const exp = editTokenExpiry(resolved.facts.window, resolved.booking.party_date)
  let token: string
  try {
    if (exp === null) throw new Error('no expiry')
    token = signEditToken({ id, edit_nonce: editNonce }, exp)
  } catch (e) {
    console.error(`api/i/rsvp: could not sign an edit token: ${e instanceof Error ? e.message : String(e)}`)
    return json(GENERIC_FAILURE, 503)
  }

  const inserted = await supabase
    .from('evite_rsvps')
    .insert({
      id,
      evite_id: eviteId,
      status: v.status,
      parent_name: v.parentName,
      children: v.children,
      adult_count: v.adultCount,
      has_allergy: v.hasAllergy,
      allergy_note: v.allergyNote,
      reminder_email: reminderEmail,
      reminder_set_at: reminderEmail ? now.toISOString() : null,
      reminder_phone_e164: reminderPhone,
      edit_nonce: editNonce,
    })
    .select(OWN_RSVP_SELECT)
    .single()
  if (inserted.error || !inserted.data) {
    console.error(`api/i/rsvp: insert failed: ${inserted.error?.message ?? 'no row'}`)
    return json(GENERIC_FAILURE, 503)
  }
  const row = inserted.data as unknown as Record<string, unknown>

  fireRsvpHook('onRsvpCreated', { eviteId, rsvpId: id, slug: params.slug, revision: Number(row.revision) || 1, status: v.status })
  await recordEviteEvent(supabase, eviteId, 'rsvp_completed')

  const res = json({ ok: true, rsvp: ownRsvpView(row), calendarUrl: `/i/${params.slug}/cal`, ...(reminderDropped ? { reminderDropped: true } : {}) })
  setRsvpCookie(res, req, eviteId, token, exp as number, now)
  return res
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const viewLimited = guardRate(req, eviteViewRule)
  if (viewLimited) return viewLimited
  const limited = guardRate(req, eviteRsvpRule)
  if (limited) return limited
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, 403)

  const gate = await openGate(req, params.slug)
  if (!gate.ok) return gate.res
  const { resolved, body, now } = gate
  const supabase = getSupabase()
  const eviteId = resolved.evite.id

  // The edit token: the header, else the cookie. Which RSVP it names is the token's business, never the body's.
  const token = req.headers.get('x-rsvp-token') || req.cookies.get(cookieName(eviteId))?.value || null
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const verified = await verifyEditToken(supabase, token, eviteId, now)
  if (!verified.ok) {
    return verified.reason === 'unavailable' ? json(GENERIC_FAILURE, 503) : json({ error: 'Unauthorized' }, 401)
  }

  const read = await supabase.from('evite_rsvps').select(OWN_RSVP_SELECT).eq('id', verified.rsvpId).eq('evite_id', eviteId).maybeSingle()
  if (read.error) {
    console.error(`api/i/rsvp: read failed: ${read.error.message}`)
    return json(GENERIC_FAILURE, 503)
  }
  if (!read.data) return json({ error: 'Unauthorized' }, 401)
  const existingRow = read.data as unknown as Record<string, unknown>
  const existing: ExistingRsvp & {
    revision: number
    club_email: string | null
    club_opt_in_at: string | null
    club_opted_out_at: string | null
    reminder_opt_out_at: string | null
  } = {
    status: existingRow.status === 'no' ? 'no' : 'yes',
    parent_name: String(existingRow.parent_name ?? ''),
    children: Array.isArray(existingRow.children) ? (existingRow.children as Array<{ first_name: string }>) : [],
    adult_count: Number(existingRow.adult_count ?? 0),
    has_allergy: typeof existingRow.has_allergy === 'boolean' ? existingRow.has_allergy : null,
    allergy_note: typeof existingRow.allergy_note === 'string' ? existingRow.allergy_note : null,
    reminder_email: typeof existingRow.reminder_email === 'string' ? existingRow.reminder_email : null,
    reminder_phone_e164: typeof existingRow.reminder_phone_e164 === 'string' ? existingRow.reminder_phone_e164 : null,
    revision: Number(existingRow.revision ?? 1),
    club_email: typeof existingRow.club_email === 'string' ? existingRow.club_email : null,
    club_opt_in_at: typeof existingRow.club_opt_in_at === 'string' ? existingRow.club_opt_in_at : null,
    club_opted_out_at: typeof existingRow.club_opted_out_at === 'string' ? existingRow.club_opted_out_at : null,
    reminder_opt_out_at: typeof existingRow.reminder_opt_out_at === 'string' ? existingRow.reminder_opt_out_at : null,
  }

  const screened = screenRsvpPatch(body, existing)
  if (!screened.ok) return json({ error: screened.message, field: screened.field }, 400)
  const p = screened.value

  // The club box: the version the guest saw must be the CURRENT one, read from the table (three outcomes).
  let consentVersion: string | null = null
  // One sign-up per RSVP, bound to its first address (finding 2): decided BEFORE anything is written or fired.
  let clubDecision: ReturnType<typeof decideClubOptIn> | null = null
  if (p.club) {
    const consent = await readCurrentClubConsent(supabase)
    if (consent.kind !== 'ok') return json(GENERIC_FAILURE, 503)
    if (consent.version !== p.club.consentVersion) {
      return json({ error: 'The sign-up wording has changed. Please reload the page and try again.' }, 409)
    }
    consentVersion = consent.version

    clubDecision = decideClubOptIn(existing, p.club.email)
    if (clubDecision.kind === 'refused') return json({ error: clubDecision.message }, 409)
    if (clubDecision.kind === 'fresh') {
      // The list-wide ceiling: no more club sign-ups on one invitation than it may have RSVPs. A failed count is not "zero".
      const joined = await supabase.from('evite_rsvps').select('id', { count: 'exact', head: true }).eq('evite_id', eviteId).not('club_opt_in_at', 'is', null)
      if (joined.error || typeof joined.count !== 'number') {
        console.error(`api/i/rsvp: club count failed: ${joined.error?.message ?? 'no count'}`)
        return json(GENERIC_FAILURE, 503)
      }
      if (joined.count >= rsvpCap(resolved.facts.guestCap)) return json({ error: 'The Birthday Club sign-up is full for this invitation — please contact the host' }, 429)
    }
  }
  const clubFresh = clubDecision?.kind === 'fresh'

  const cols: Record<string, unknown> = { ...p.columns }
  const nowIso = now.toISOString()
  let reminderDropped = false

  if (p.newReminderEmail) {
    // Setting or CHANGING the reminder address by PATCH goes through the same caps as the POST, and stamps
    // `reminder_set_at` so the 24-hour count and the cron's `rsvp_confirmed` sweep see when it was set.
    if (await reminderEmailAllowed(supabase, eviteId, p.newReminderEmail)) {
      cols.reminder_set_at = nowIso
    } else {
      reminderDropped = true
      delete cols.reminder_email
      delete cols.reminder_phone_e164
      delete cols.reminder_opt_out_at
    }
  }
  if (p.reminderOptOut && !existing.reminder_opt_out_at) cols.reminder_opt_out_at = nowIso

  const material =
    p.next.status !== existing.status ||
    p.next.children.length !== existing.children.length ||
    p.next.adult_count !== existing.adult_count ||
    p.next.has_allergy !== existing.has_allergy
  if (material) cols.revision = existing.revision + 1

  let monthSaved = false
  if (p.club && consentVersion) {
    if (clubFresh) {
      cols.club_email = p.club.email
      cols.club_opt_in_at = nowIso
      cols.opt_in_text_version = consentVersion
      cols.consent_ip = consentIp(req)
      if (p.club.birthdayMonth !== null) cols.birthday_month = p.club.birthdayMonth
    } else if (p.club.birthdayMonth !== null) {
      // 'unchanged': the same address again. The consent record and the hook are NOT touched; only the month may move.
      cols.birthday_month = p.club.birthdayMonth
    }
    monthSaved = p.club.birthdayMonth !== null
  }
  // `club_opted_out_at` is written once and never cleared (decideClubOptIn): a second opt-out keeps the first time.
  const optingOut = p.clubOptOut && existing.club_opt_in_at !== null && existing.club_opted_out_at === null
  if (optingOut) cols.club_opted_out_at = nowIso

  const calendarUrl = `/i/${params.slug}/cal`
  if (Object.keys(cols).length === 0) {
    // Everything asked for was refused or already true (e.g. a reminder address over its daily cap).
    return json({ ok: true, rsvp: ownRsvpView(existingRow), calendarUrl, ...(reminderDropped ? { reminderDropped: true } : {}) })
  }

  // Conditional on the revision we read: two tabs changing the party cannot silently overwrite each other.
  let write = supabase
    .from('evite_rsvps')
    .update(cols)
    .eq('id', verified.rsvpId)
    .eq('evite_id', eviteId)
    .eq('revision', existing.revision)
  // A first club sign-up also holds "still never opted in": two tabs with two addresses cannot both win.
  if (clubFresh) write = write.is('club_opt_in_at', null)
  const updated = await write.select(OWN_RSVP_SELECT)
  if (updated.error) {
    console.error(`api/i/rsvp: update failed: ${updated.error.message}`)
    return updated.error.code === '23514' ? json({ error: 'That answer is not valid.' }, 400) : json(GENERIC_FAILURE, 503)
  }
  const rows = (updated.data ?? []) as unknown as Array<Record<string, unknown>>
  if (rows.length === 0) return json({ error: 'This RSVP was changed somewhere else. Please reload the page.' }, 409)
  const row = rows[0]

  if (material) {
    fireRsvpHook('onRsvpChanged', { eviteId, rsvpId: verified.rsvpId, slug: params.slug, revision: Number(row.revision) || existing.revision + 1, status: p.next.status })
  }
  if (p.club && consentVersion) {
    if (clubFresh) await recordEviteEvent(supabase, eviteId, 'club_opted_in')
    if (monthSaved) await recordEviteEvent(supabase, eviteId, 'birthday_month_saved')
  }
  if (p.club && consentVersion && clubFresh) {
    fireClubOptIn(supabase, {
      email: p.club.email,
      parentName: String(row.parent_name ?? existing.parent_name),
      birthdayMonth: typeof row.birthday_month === 'number' ? row.birthday_month : p.club.birthdayMonth,
      slug: params.slug,
      consentVersion,
      rsvpId: verified.rsvpId,
    })
  }
  if (optingOut) {
    fireClubOptOut(supabase, { email: typeof row.club_email === 'string' ? row.club_email : null, rsvpId: verified.rsvpId })
  }

  return json({ ok: true, rsvp: ownRsvpView(row), calendarUrl, ...(reminderDropped ? { reminderDropped: true } : {}) })
}
