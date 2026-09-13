import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generatePortalToken, buildPortalUrl, portalSigningSecret } from '@/lib/portalAuth'
import { partyPortalMagicLinkHtml } from '@/lib/emailTemplates'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { publicOrigin } from '@/lib/publicOrigin'
import {
  findBookingsByContactEmail,
  findContactsByEmail,
  isPlausibleEmailAddress,
} from '@/lib/contactLookup'

/**
 * Throttle by identifier so this public endpoint can't be used to text-bomb a
 * number or mail-bomb an address. In-memory is adequate: the website runs as a
 * single container, and the worst case of a restart is a reset counter.
 */
const RESEND_WINDOW_MS = 15 * 60 * 1000
const RESEND_MAX_PER_WINDOW = 3
const resendHits = new Map<string, number[]>()

function isThrottled(identifier: string): boolean {
  const now = Date.now()
  const recent = (resendHits.get(identifier) || []).filter(t => now - t < RESEND_WINDOW_MS)
  if (recent.length >= RESEND_MAX_PER_WINDOW) {
    resendHits.set(identifier, recent)
    return true
  }
  recent.push(now)
  resendHits.set(identifier, recent)
  return false
}

/** Last 10 digits, so "(631) 555-1234" and "+16315551234" compare equal. */
function phoneKey(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10)
}

/**
 * ── The defect this route carried, and why it was the expensive one ────────
 *
 * `/my-booking/login` is the ONLY sign-in the site offers a customer — the
 * 6-digit-code pair next door has no UI at all (two rows in
 * `email_auth_codes`, both from the day it was built). And this route looked
 * the address up with `.eq('contact_email', email.toLowerCase())`, which is
 * case-SENSITIVE, against a `text` column holding whatever the customer typed.
 *
 * Measured in production 2026-09-12: **9 of 61 bookings carry a mixed-case
 * address, and the query this route actually runs returned zero rows for seven
 * of them** — two `deposit_paid`, one `approved`, two `modifications_locked`.
 * Those seven people typed their address into the only login on the site, were
 * shown *"Check your email!"*, and nothing was sent. Ever. That is rule 10's
 * expensive half on the surface where the customer then waits.
 *
 * The always-`{ok:true}` answer is kept — it is deliberate anti-enumeration and
 * the page's copy hedges correctly ("If we have a booking on file…"). What
 * changes is that the lookup now finds them, and that every path which fails to
 * send says so in the log instead of being indistinguishable from a success.
 */
export async function POST(req: NextRequest) {
  // `await req.json()` was unguarded and `email.toLowerCase()` assumed a string:
  // `{"email":123}`, `{"email":{}}` and a non-JSON body each 500'd the public
  // login endpoint. Measured.
  const body = (await req.json().catch(() => null)) as { email?: unknown; phone?: unknown } | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Email or phone required' }, { status: 400 })
  }
  const email = typeof body.email === 'string' ? body.email : undefined
  const phone = typeof body.phone === 'string' || typeof body.phone === 'number' ? String(body.phone) : undefined

  if (!email && !phone) {
    return NextResponse.json({ error: 'Email or phone required' }, { status: 400 })
  }
  if (email && !isPlausibleEmailAddress(email)) {
    // A shape error, not an enumeration signal — safe to say so, and it keeps a
    // LIKE pattern out of the lookup below.
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const supabase = getSupabase()
  const secret = portalSigningSecret()

  // Phone path: contact_phone is stored as the customer typed it, so exact
  // matching is unreliable. Compare on trailing digits instead.
  if (phone && !email) {
    const key = phoneKey(String(phone))
    if (key.length !== 10) {
      // Shape error, not an enumeration signal — safe to say so.
      return NextResponse.json({ error: 'Enter a 10-digit US phone number' }, { status: 400 })
    }
    if (isThrottled(`sms:${key}`)) {
      return NextResponse.json({ ok: true, throttled: true })
    }

    const { data: candidates, error: candErr } = await supabase
      .from('bookings')
      .select('id, booking_ref, contact_name, contact_phone')
      .not('contact_phone', 'is', null)
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (candErr) {
      console.error('resend-link: phone candidate read failed:', candErr.message)
      return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
    }

    const match = (candidates || []).find(b => phoneKey(b.contact_phone || '') === key)

    // Always report success — never reveal whether a number is on file.
    if (!match) return NextResponse.json({ ok: true })

    const { token: rawToken, hash, expiresAt } = generatePortalToken(match.booking_ref, secret)
    // Rule 19. A discarded error here mints a link whose token row does not
    // exist — the customer clicks it and is told it expired, which is the most
    // confusing failure this surface can produce.
    const { error: tokErr } = await supabase.from('portal_tokens').insert({
      booking_id: match.id,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    })
    if (tokErr) {
      console.error('resend-link: portal token insert failed for', match.booking_ref, '—', tokErr.message)
      return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
    }

    const portalUrl = buildPortalUrl(match.booking_ref, rawToken)
    const firstName = (match.contact_name || '').trim().split(/\s+/)[0] || 'there'
    // Transactional — Quo, per the SMS routing policy in lib/sms.ts.
    const smsRes = await sendSMSVia(
      'quo',
      normalizePhone(match.contact_phone!),
      `Hi ${firstName}! Here's your Host Hampton party planner link: ${portalUrl} Reply STOP to opt out`
    )
    // `sendSMSVia` resolves `null` on a provider rejection; it does not throw.
    // "Check your texts!" over a text that was refused is rule 10's other half.
    if (!smsRes) {
      console.error('resend-link: SMS was NOT delivered for', match.booking_ref)
    }

    return NextResponse.json({ ok: true })
  }

  const normalizedEmail = email!.toLowerCase().trim()
  if (isThrottled(`email:${normalizedEmail}`)) {
    return NextResponse.json({ ok: true, throttled: true })
  }

  // Find booking by email — case-insensitively, and NOT by trusting the `ilike`
  // pattern. See lib/contactLookup.ts; this is the lookup that was missing
  // seven real customers.
  const bookingLookup = await findBookingsByContactEmail(
    supabase,
    normalizedEmail,
    'id, booking_ref, contact_name, contact_email, created_at',
    { excludeCancelled: true },
  )
  if (bookingLookup.kind === 'unavailable') {
    console.error('resend-link: booking read failed:', bookingLookup.error)
    return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
  }
  const booking = bookingLookup.kind === 'found'
    ? bookingLookup.bookings
        .slice()
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]
    : null

  // Always return success to prevent email enumeration
  if (!booking) {
    // Check for saved quotes in contact_interactions
    const contactLookup = await findContactsByEmail(supabase, normalizedEmail, 'id, email')
    if (contactLookup.kind === 'unavailable') {
      console.error('resend-link: contact read failed:', contactLookup.error)
      return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
    }
    const contact = contactLookup.kind === 'found' ? contactLookup.contacts[0] : null

    if (contact) {
      const { data: interaction, error: interErr } = await supabase
        .from('contact_interactions')
        .select('metadata')
        .eq('contact_id', contact.id)
        .eq('type', 'form_submission')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (interErr) {
        console.error('resend-link: saved-quote read failed:', interErr.message)
        return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
      }

      if (interaction?.metadata?.action === 'save_for_later' && interaction.metadata.quoteData) {
        const origin = publicOrigin(req)
        const encoded = Buffer.from(JSON.stringify(interaction.metadata.quoteData)).toString('base64url')
        const quoteLink = `${origin}/kids-party-menu?q=${encoded}`

        if (process.env.RESEND_API_KEY) {
          const { Resend } = await import('resend')
          const resend = new Resend(process.env.RESEND_API_KEY)
          const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
          const { savedQuoteHtml } = await import('@/lib/emailTemplates')

          const res = await resend.emails.send({
            from,
            to: normalizedEmail,
            subject: 'Your Saved Party Quote — Host Hampton',
            html: savedQuoteHtml({
              customerName: interaction.metadata.quoteData.contactName || 'there',
              quoteLink,
              summary: interaction.metadata.quoteData.summary || '',
            }),
          }).catch(err => ({ error: err }))
          if ((res as { error?: unknown }).error) {
            console.error('resend-link: saved-quote email NOT sent to', normalizedEmail,
              (res as { error?: unknown }).error)
          }
        } else {
          console.error('resend-link: RESEND_API_KEY unset — saved-quote email NOT sent')
        }
      }
    }

    return NextResponse.json({ ok: true })
  }

  const { token: rawToken, hash, expiresAt } = generatePortalToken(String(booking.booking_ref), secret)

  const { error: tokErr } = await supabase.from('portal_tokens').insert({
    booking_id: booking.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  })
  if (tokErr) {
    console.error('resend-link: portal token insert failed for', booking.booking_ref, '—', tokErr.message)
    return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
  }

  const portalUrl = buildPortalUrl(String(booking.booking_ref), rawToken)

  // The address we send to is the one ON THE BOOKING, not the one the caller
  // typed — the two can differ in case, and the booking row is the record.
  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const res = await resend.emails.send({
      from,
      to: String(booking.contact_email),
      subject: `Your Booking Portal Link — ${booking.booking_ref}`,
      html: partyPortalMagicLinkHtml({
        customerName: (booking.contact_name as string | null) ?? '',
        bookingRef: String(booking.booking_ref),
        portalUrl,
      }),
    }).catch(err => ({ error: err }))
    if ((res as { error?: unknown }).error) {
      // Rule 10: the page says "Check your email!". If nothing went out, the
      // only place that can ever say so is this line.
      console.error('resend-link: portal link email NOT sent for', booking.booking_ref,
        (res as { error?: unknown }).error)
    }
  } else {
    console.error('resend-link: RESEND_API_KEY unset — portal link NOT sent for', booking.booking_ref)
  }

  return NextResponse.json({ ok: true })
}
