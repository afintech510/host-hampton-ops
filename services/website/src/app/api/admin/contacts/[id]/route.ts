import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse, adminActorId } from '@/lib/adminAuth'
import { findContactsByEmail, CONTACT_STATUSES } from '@/lib/contactLookup'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const [contactRes, interactionsRes, remindersRes] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('contact_interactions')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('scheduled_reminders')
      .select('*')
      .eq('contact_id', id)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true }),
  ])

  // Rule 12: "could not read" is not "no such contact". A Supabase blip used to
  // present in the panel as a confident 404 for a customer who plainly exists.
  if (contactRes.error) {
    console.error('admin:contact read failed:', contactRes.error.message)
    return NextResponse.json({ error: 'Could not read that contact right now' }, { status: 503 })
  }
  if (!contactRes.data) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  // If this person has more than one contact row, the panel must say so: an
  // opt-out set here applies to THIS row only, and eight real people have two.
  // needs-Adam 31.
  const email = (contactRes.data as { email?: string | null }).email
  let siblings: { id: string; email: string | null }[] = []
  if (email) {
    const dupes = await findContactsByEmail(supabase, email, 'id, email')
    if (dupes.kind === 'found' && dupes.contacts.length > 1) {
      siblings = dupes.contacts.filter(c => c.id !== id).map(c => ({ id: c.id, email: c.email }))
    }
  }

  return NextResponse.json({
    contact: contactRes.data,
    interactions: interactionsRes.data || [],
    reminders: remindersRes.data || [],
    duplicateRows: siblings,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()

  const allowed: Record<string, any> = {}
  if (body.status !== undefined) {
    // Read out of `pg_enum` on 2026-09-12 rather than remembered (rule 13). A
    // value outside it is a 500 from Postgres and a stack trace in the panel.
    if (!(CONTACT_STATUSES as readonly string[]).includes(String(body.status))) {
      return NextResponse.json(
        { error: `status must be one of: ${CONTACT_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
    allowed.status = body.status
  }
  if (body.notes !== undefined) allowed.notes = body.notes
  if (body.email_opt_in !== undefined) allowed.email_opt_in = !!body.email_opt_in
  if (body.sms_opt_in !== undefined) allowed.sms_opt_in = !!body.sms_opt_in

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // `.select('id')` because an UPDATE with no select cannot tell you it matched
  // nothing (rule 19) — this used to answer `{ok: true}` for an id that does
  // not exist, on the surface where the field being written is somebody's
  // marketing consent.
  const { data, error } = await supabase.from('contacts').update(allowed).eq('id', id).select('id')

  if (error) {
    console.error('admin:contact update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  const changedConsent = 'email_opt_in' in allowed || 'sms_opt_in' in allowed || 'status' in allowed
  if (changedConsent) {
    console.log(
      `admin:contact ${id} consent/status changed by ${adminActorId(req)}: ${JSON.stringify(allowed)}`
    )
  }

  return NextResponse.json({ ok: true })
}
