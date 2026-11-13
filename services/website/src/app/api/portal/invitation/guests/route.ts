import { NextRequest } from 'next/server'
import { formatGuestPhone, matchGuests, parseGuestList, GUEST_LIST_MAX } from '@/lib/evites/guestList'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { hostJson, openHostGate, type HostGate } from '@/lib/evites/hostGate'

/**
 * The host's guest list (migration 097 `evite_guests`). Portal-gated like `/api/portal/invitation`: the
 * `hh_portal` cookie names the booking, the evite is found through it, and nothing in the body can name
 * another one. Nothing here emails or texts anybody: the page offers the host an `sms:` link that opens
 * THEIR messaging app. Names and phone numbers are never logged.
 *
 *   GET     -> { guests: [{ id, name, phone, phoneE164, answer, linkedRsvpId, matchedRsvpId }],
 *                unmatchedRsvps: [{ id, status, name, guests }], summary: { invited, yes, no, waiting, peopleComing } }
 *               (`answer` is matched by name unless the host linked an answer by hand)
 *   PATCH   { id, rsvpId: uuid | null }  -> { ok, linkedRsvpId }   link / unlink a guest to an answer; both must be THIS evite's
 *   POST    { text }  -> { added, skipped: string[], total }   re-parsed here with `parseGuestList`
 *   DELETE  { id } | { all: true }  -> { removed }            scoped to THIS evite
 *
 * 401 without a session; 404 `no-invitation`; 409 on POST once the party has happened.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BODY_MAX_CHARS = 100_000
const COLUMNS = 'id, name, phone_e164, rsvp_id, created_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type GuestRow = { id: string; name: string; phone_e164: string | null; rsvp_id?: string | null; created_at: string }
type RsvpRow = { id: string; status: 'yes' | 'no'; parent_name: string; children: Array<{ first_name?: string }> }
type OpenGate = Extract<HostGate, { ok: true }>

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text()
    if (text.length > BODY_MAX_CHARS) return null
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function listGuests(gate: OpenGate): Promise<GuestRow[] | null> {
  const { data, error } = await gate.supabase
    .from('evite_guests')
    .select(COLUMNS)
    .eq('evite_id', gate.loaded.evite.id)
    .order('created_at', { ascending: true })
  if (error) {
    console.error(`portal/invitation/guests: read failed: ${error.message}`)
    return null
  }
  return (data ?? []) as unknown as GuestRow[]
}

async function listRsvps(gate: OpenGate): Promise<RsvpRow[] | null> {
  const { data, error } = await gate.supabase
    .from('evite_rsvps')
    .select('id, status, parent_name, children, created_at')
    .eq('evite_id', gate.loaded.evite.id)
    .order('created_at', { ascending: true })
  if (error) {
    console.error(`portal/invitation/guests: rsvp read failed: ${error.message}`)
    return null
  }
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    status: r.status === 'no' ? 'no' : 'yes',
    parent_name: typeof r.parent_name === 'string' ? r.parent_name : '',
    children: Array.isArray(r.children) ? (r.children as Array<{ first_name?: string }>) : [],
  }))
}

const kidNames = (r: RsvpRow): string[] =>
  r.children.map((c) => (c && typeof c === 'object' ? c.first_name : null)).filter((n): n is string => typeof n === 'string' && n !== '')

export async function GET(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/guests'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/guests', { rejectClosed: false })
  if (!gate.ok) return gate.res
  const rows = await listGuests(gate)
  if (!rows) return hostJson({ error: 'Could not load your guest list - try again.' }, 503)
  const rsvps = await listRsvps(gate)
  if (!rsvps) return hostJson({ error: 'Could not load your guest list - try again.' }, 503)
  const m = matchGuests(rows.map((g) => ({ name: g.name, rsvpId: g.rsvp_id ?? null })), rsvps)
  const yes = m.matches.filter((x) => x.answer === 'yes').length
  const no = m.matches.filter((x) => x.answer === 'no').length
  return hostJson({
    guests: rows.map((g, i) => ({
      id: g.id,
      name: g.name,
      phone: g.phone_e164 ? formatGuestPhone(g.phone_e164) : null,
      phoneE164: g.phone_e164,
      answer: m.matches[i].answer,
      linkedRsvpId: g.rsvp_id ?? null,
      matchedRsvpId: m.matches[i].rsvpId,
    })),
    unmatchedRsvps: m.unmatchedRsvps.map((i) => ({ id: rsvps[i].id, status: rsvps[i].status, name: rsvps[i].parent_name, guests: kidNames(rsvps[i]) })),
    summary: {
      invited: rows.length,
      yes,
      no,
      waiting: rows.length - yes - no,
      peopleComing: rsvps.filter((r) => r.status === 'yes').reduce((n, r) => n + kidNames(r).length, 0),
    },
  })
}

export async function POST(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/guests'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/guests', { rejectClosed: true })
  if (!gate.ok) return gate.res
  const body = await readBody(req)
  if (!body || typeof body.text !== 'string') return hostJson({ error: 'Please paste your guest list first.', field: 'text' }, 400)

  const parsed = parseGuestList(body.text)
  if (parsed.guests.length === 0) {
    return hostJson({ error: 'We could not find any guests in that. Put one name per line, with an optional phone number after a comma.', field: 'text' }, 400)
  }

  const existing = await listGuests(gate)
  if (!existing) return hostJson({ error: 'Could not save your guest list - try again.' }, 503)
  const have = new Set(existing.map((g) => `${g.name.toLowerCase()}|${g.phone_e164 ?? ''}`))
  const skipped = [...parsed.skipped]
  let fresh = parsed.guests.filter((g) => !have.has(`${g.name.toLowerCase()}|${g.phone_e164 ?? ''}`))
  const room = Math.max(0, GUEST_LIST_MAX - existing.length)
  if (fresh.length > room) {
    const over = fresh.length - room
    skipped.push(`${over} more ${over === 1 ? 'guest was' : 'guests were'} left out: a list holds up to ${GUEST_LIST_MAX}.`)
    fresh = fresh.slice(0, room)
  }

  if (fresh.length > 0) {
    const eviteId = gate.loaded.evite.id // from the cookie's booking, never the body
    const { error } = await gate.supabase.from('evite_guests').insert(fresh.map((g) => ({ evite_id: eviteId, name: g.name, phone_e164: g.phone_e164 })))
    if (error) {
      console.error(`portal/invitation/guests: insert failed: ${error.message}`)
      return hostJson({ error: 'Could not save your guest list - try again.' }, 503)
    }
  }
  return hostJson({ added: fresh.length, skipped, total: existing.length + fresh.length })
}

export async function DELETE(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/guests'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/guests', { rejectClosed: false })
  if (!gate.ok) return gate.res
  const body = await readBody(req)
  if (!body) return hostJson({ error: 'Invalid request' }, 400)
  const eviteId = gate.loaded.evite.id

  let q = gate.supabase.from('evite_guests').delete().eq('evite_id', eviteId)
  if (body.all === true) {
    // every guest of THIS invitation, and only this one
  } else if (typeof body.id === 'string' && /^[0-9a-f-]{8,40}$/i.test(body.id)) {
    q = q.eq('id', body.id)
  } else {
    return hostJson({ error: 'Invalid request' }, 400)
  }
  const { data, error } = await q.select('id')
  if (error) {
    console.error(`portal/invitation/guests: delete failed: ${error.message}`)
    return hostJson({ error: 'Could not remove that - try again.' }, 503)
  }
  return hostJson({ removed: (data ?? []).length })
}

export async function PATCH(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/guests'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/guests', { rejectClosed: true })
  if (!gate.ok) return gate.res
  const body = await readBody(req)
  if (!body || typeof body.id !== 'string' || !UUID_RE.test(body.id)) return hostJson({ error: 'Invalid request' }, 400)
  const rsvpId = body.rsvpId
  if (rsvpId !== null && (typeof rsvpId !== 'string' || !UUID_RE.test(rsvpId))) return hostJson({ error: 'Invalid request' }, 400)
  const eviteId = gate.loaded.evite.id // from the cookie's booking, never the body

  const mine = await listGuests(gate)
  if (!mine) return hostJson({ error: 'Could not save that - try again.' }, 503)
  if (!mine.some((g) => g.id === body.id)) return hostJson({ error: 'not-found' }, 404)
  if (rsvpId !== null) {
    const rsvps = await listRsvps(gate)
    if (!rsvps) return hostJson({ error: 'Could not save that - try again.' }, 503)
    if (!rsvps.some((r) => r.id === rsvpId)) return hostJson({ error: 'not-found' }, 404)
  }
  const { error } = await gate.supabase.from('evite_guests').update({ rsvp_id: rsvpId }).eq('evite_id', eviteId).eq('id', body.id)
  if (error) {
    console.error(`portal/invitation/guests: link failed: ${error.message}`)
    return hostJson({ error: 'Could not save that - try again.' }, 503)
  }
  return hostJson({ ok: true, linkedRsvpId: rsvpId })
}
