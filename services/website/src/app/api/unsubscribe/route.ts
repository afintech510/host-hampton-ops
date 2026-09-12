import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { verifyUnsubscribeToken } from '@/lib/unsubscribeLink'
import { logInteraction } from '@/lib/contactInteractions'

export const dynamic = 'force-dynamic'

/**
 * RFC 8058 one-click unsubscribe, and the target of the confirmation page's
 * form.
 *
 * POST only, on purpose. Corporate mail scanners and link previewers GET every
 * URL in a message; an unsubscribe that acted on GET would opt people out who
 * never clicked anything. `/unsubscribe` (the page) renders on GET and does
 * nothing; this endpoint acts.
 *
 * Nothing here reads an email address from the request body — only the address
 * the signed token names. Otherwise this is an endpoint for unsubscribing
 * strangers.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t')
  const email = verifyUnsubscribeToken(token)

  if (!email) {
    // Same answer for forged, malformed and unsigned: this must not become an
    // oracle for whether an address is on the list.
    return NextResponse.json({ error: 'Invalid or expired unsubscribe link' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: contacts, error: readErr } = await supabase
    .from('contacts')
    .select('id, email_opt_in, status')
    .eq('email', email)

  if (readErr) {
    // Rule 12: "could not tell" is not "done". A 500 makes the mail client
    // retry and the person see the page, rather than a cheerful confirmation
    // over a write that never happened.
    console.error('unsubscribe: contact read failed:', readErr.message)
    return NextResponse.json({ error: 'Could not process right now — please try again' }, { status: 500 })
  }

  // An address with no contact row still gets a success answer: there is
  // nothing to opt out, and saying "we have never heard of you" tells a
  // stranger holding a token whether an address is on the list. It IS logged.
  if (!contacts || contacts.length === 0) {
    console.warn(`unsubscribe: no contact row for a validly-signed address (${maskEmail(email)})`)
    return NextResponse.json({ ok: true, alreadyOff: true })
  }

  const { error: updErr } = await supabase
    .from('contacts')
    .update({ email_opt_in: false })
    .eq('email', email)

  if (updErr) {
    console.error('unsubscribe: opt-out write failed:', updErr.message)
    return NextResponse.json({ error: 'Could not process right now — please try again' }, { status: 500 })
  }

  // Stop every sequence they are in, at once. The processor re-checks opt-out
  // before each step anyway, so this is belt and braces — but it makes the
  // effect visible in the admin surfaces immediately instead of at the next tick.
  const ids = contacts.map(c => c.id)
  const { error: seqErr } = await supabase
    .from('contact_sequence_enrollments')
    .update({ status: 'unsubscribed' })
    .in('contact_id', ids)
    .eq('status', 'active')
  if (seqErr) console.error('unsubscribe: enrollment stop failed (opt-out still recorded):', seqErr.message)

  for (const c of contacts) {
    await logInteraction(supabase, {
      contactId: c.id,
      type: 'email_unsubscribed',
      summary: 'Unsubscribed via the link in an automated email',
      metadata: { source: 'unsubscribe_link', one_click: req.headers.get('content-type') ?? null },
    })
  }

  console.log(`unsubscribe: opted out ${maskEmail(email)} (${ids.length} contact row(s))`)
  return NextResponse.json({ ok: true })
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
