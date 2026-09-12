import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { verifyUnsubscribeToken } from '@/lib/unsubscribeLink'
import { logInteraction } from '@/lib/contactInteractions'
import { findContactsByEmail } from '@/lib/contactLookup'

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

  // Case-INSENSITIVE, because the token always names a lowercased address and
  // 21 real contacts do not store one. `.eq('email', …)` found none of them and
  // this endpoint answered 200 over a write that never happened — see
  // lib/contactLookup.ts for the measurement.
  const lookup = await findContactsByEmail(supabase, email)

  if (lookup.kind === 'unavailable') {
    // Rule 12: "could not tell" is not "done". A 500 makes the mail client
    // retry and the person see the page, rather than a cheerful confirmation
    // over a write that never happened.
    console.error('unsubscribe: contact read failed:', lookup.error)
    return NextResponse.json({ error: 'Could not process right now — please try again' }, { status: 500 })
  }

  // An address with no contact row gets the SAME answer a real one gets —
  // byte-identical, not `alreadyOff: true`. The old body said in JSON exactly
  // what the comment above it said must never be said: it told whoever held the
  // token whether that address is on the list. It IS logged, where it belongs.
  if (lookup.kind === 'absent') {
    console.warn(`unsubscribe: no contact row for a validly-signed address (${maskEmail(email)})`)
    return NextResponse.json({ ok: true })
  }

  const contacts = lookup.contacts
  const ids = contacts.map(c => c.id)

  // By id, never by the email filter: `ilike` can over-match (`_` is a LIKE
  // wildcard), so the rows this writes to are the rows the exact comparison
  // agreed on and nobody else's.
  const { error: updErr } = await supabase
    .from('contacts')
    .update({ email_opt_in: false })
    .in('id', ids)

  if (updErr) {
    console.error('unsubscribe: opt-out write failed:', updErr.message)
    return NextResponse.json({ error: 'Could not process right now — please try again' }, { status: 500 })
  }

  // Stop every sequence they are in, at once. The processor re-checks opt-out
  // before each step anyway, so this is belt and braces — but it makes the
  // effect visible in the admin surfaces immediately instead of at the next tick.
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
