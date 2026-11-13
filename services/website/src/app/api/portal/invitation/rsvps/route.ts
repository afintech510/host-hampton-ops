import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { hostJson, openHostGate } from '@/lib/evites/hostGate'
import { newEditNonce } from '@/lib/evites/rsvpToken'
import { rsvpCap } from '@/lib/evites/rsvpHttp'
import { screenRsvpPost } from '@/lib/evites/screens'

/**
 * Answers the HOST types in for a guest who replied by phone or text. Portal-gated; the evite is found
 * through the cookie's booking only.
 *
 *   GET     -> { rsvps: [{ id, status, name, guests: string[], hasAllergy, allergyNote, addedByHost }] }
 *   POST    { status, parentName, children: [firstName...], hasAllergy?, allergyNote? }  -> { ok, id }
 *   DELETE  { id }  -> { removed }          any RSVP of THIS invitation (so a mistake can be fixed)
 *
 * The POST goes through the same `screenRsvpPost` as a guest's (with the invitation's audience), stores
 * `added_by_host = true`, no reminder address or number, and a fresh `edit_nonce` nobody holds a token
 * for. It does NOT fire `rsvpHooks`: the host just typed it, so no "new RSVP" email goes to anyone, and
 * nothing at all is sent. Names are never logged.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BODY_MAX_CHARS = 10_000

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

export async function GET(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/rsvps'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/rsvps', { rejectClosed: false })
  if (!gate.ok) return gate.res
  const { data, error } = await gate.supabase
    .from('evite_rsvps')
    .select('id, status, parent_name, children, has_allergy, allergy_note, added_by_host, created_at')
    .eq('evite_id', gate.loaded.evite.id)
    .order('created_at', { ascending: true })
  if (error) {
    console.error(`portal/invitation/rsvps: read failed: ${error.message}`)
    return hostJson({ error: 'Could not load the answers - try again.' }, 503)
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  return hostJson({
    rsvps: rows.map((r) => ({
      id: String(r.id),
      status: r.status === 'no' ? 'no' : 'yes',
      name: typeof r.parent_name === 'string' ? r.parent_name : '',
      guests: (Array.isArray(r.children) ? r.children : [])
        .map((c) => (c && typeof c === 'object' ? (c as { first_name?: unknown }).first_name : null))
        .filter((n): n is string => typeof n === 'string' && n !== ''),
      hasAllergy: r.has_allergy === true,
      allergyNote: typeof r.allergy_note === 'string' ? r.allergy_note : null,
      addedByHost: r.added_by_host === true,
    })),
  })
}

export async function POST(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/rsvps'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/rsvps', { rejectClosed: true })
  if (!gate.ok) return gate.res
  const body = await readBody(req)
  if (!body) return hostJson({ error: 'Invalid request' }, 400)
  const eviteId = gate.loaded.evite.id // from the cookie's booking, never the body

  // The same screens a guest's answer goes through. `guestId` is only a form convenience and is ignored;
  // anything reminder-shaped in the body is dropped (no reminder for an answer the host typed).
  const { reminderContact: _dropped, ...rest } = body
  void _dropped
  // `children` is a list of first names; the shared screen takes `{ firstName }` objects (a guest's form sends those).
  const children = Array.isArray(rest.children) ? rest.children.map((c: unknown) => (typeof c === 'string' ? { firstName: c } : c)) : rest.children
  const screened = screenRsvpPost({ ...rest, children }, gate.audience)
  if (!screened.ok) return hostJson({ error: screened.message, field: screened.field }, 400)
  const v = screened.value

  const count = await gate.supabase.from('evite_rsvps').select('id', { count: 'exact', head: true }).eq('evite_id', eviteId)
  if (count.error || typeof count.count !== 'number') {
    console.error(`portal/invitation/rsvps: count failed: ${count.error?.message ?? 'no count'}`)
    return hostJson({ error: 'Could not save that - try again.' }, 503)
  }
  if (count.count >= rsvpCap(gate.guestCap)) return hostJson({ error: 'This list is full.' }, 429)

  const id = randomUUID()
  const { error: insertError } = await gate.supabase
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
      reminder_email: null,
      reminder_phone_e164: null,
      edit_nonce: newEditNonce(),
      added_by_host: true,
    })
    .select('id')
    .single()
  if (insertError) {
    console.error(`portal/invitation/rsvps: insert failed: ${insertError.message}`)
    return hostJson({ error: 'Could not save that - try again.' }, 503)
  }
  console.log(`portal/invitation/rsvps: host added an answer (${v.status}, ${v.children.length} guests)`)
  return hostJson({ ok: true, id })
}

export async function DELETE(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)
  // A customer working a form: plannerRule, not intakeRule (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation/rsvps'))
  if (limited) return limited
  const gate = await openHostGate(req, bookingRef, 'portal/invitation/rsvps', { rejectClosed: false })
  if (!gate.ok) return gate.res
  const body = await readBody(req)
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f-]{8,40}$/i.test(body.id)) return hostJson({ error: 'Invalid request' }, 400)

  const { data, error } = await gate.supabase.from('evite_rsvps').delete().eq('evite_id', gate.loaded.evite.id).eq('id', body.id).select('id')
  if (error) {
    console.error(`portal/invitation/rsvps: delete failed: ${error.message}`)
    return hostJson({ error: 'Could not remove that - try again.' }, 503)
  }
  const removed = (data ?? []).length
  console.log(`portal/invitation/rsvps: host removed an answer (${removed})`)
  return hostJson({ removed })
}
