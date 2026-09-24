/**
 * Vendor registration for a Host Hampton market.
 *
 * ── THE SHAPE, AND WHY IT IS NOT THE OLD ONE ──
 *
 * `/api/vendor-registration` (the Spring Market route this replaces) creates a
 * Stripe session and returns. The row is written later, by the webhook, from
 * Stripe metadata. That means a vendor who fills in the whole form and then
 * closes the card page leaves NOTHING behind — no name, no email, no record
 * that they were interested. On a nine-booth market those are the people most
 * worth a follow-up text.
 *
 * Here the row is written FIRST, at `pending_payment`, and the payment is
 * attached to it. Both payment methods go through the same door:
 *
 *   card  → row, then a Stripe session whose metadata carries the row id;
 *           the webhook flips it to 'paid'.
 *   venmo → row, and the response carries the Venmo credentials.
 *
 * That last line is the "must complete all info to reveal Venmo" requirement,
 * and note where it is enforced: the credentials are in the RESPONSE to a
 * successful insert. A client-side reveal (the /esm-sharks `classList` toggle)
 * shows the handle to anyone who opens devtools and captures nothing. This one
 * cannot hand over the handle without first having the vendor's details in the
 * database, because the handle is not in the bundle at all.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { publicOrigin } from '@/lib/publicOrigin'
import { getSupabase } from '@/lib/supabase'
import {
  resolveMarket,
  marketPricing,
  isMarketClosed,
  isVendorPaymentMethod,
  VENDOR_CATEGORIES,
  CHRISTMAS_MARKET_2026,
} from '@/lib/christmasMarket'

// Lifted into lib/intakeFields.ts when the appointment book route needed the
// same three screens. A second copy is how two intake routes come to disagree
// about what an email address looks like.
import { clean, looksLikeEmail, looksLikePhone, MAX_FIELD } from '@/lib/intakeFields'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = guardRate(req, intakeRule('christmas-market-vendor'))
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // The market is resolved from a registry, never trusted from the browser as a
  // free string — an unknown slug is a 400, not a row filed under a market that
  // does not exist. Defaulted so the form does not have to send it.
  const market = resolveMarket(clean(body.marketSlug) || CHRISTMAS_MARKET_2026.slug)
  if (!market) {
    return NextResponse.json({ error: 'Unknown market' }, { status: 400 })
  }

  if (isMarketClosed(market)) {
    return NextResponse.json(
      { error: `${market.shortName} registration is closed.` },
      { status: 410 },
    )
  }

  const contactName = clean(body.contactName, 120)
  const businessName = clean(body.businessName, 160)
  const email = clean(body.email, 160)
  const phone = clean(body.phone, 40)
  const productCategory = clean(body.productCategory, 80)
  const productDescription = clean(body.productDescription, MAX_FIELD)
  const boothNote = clean(body.boothNote, MAX_FIELD)
  const needsElectricity = body.needsElectricity === true
  const paymentMethod = clean(body.paymentMethod, 20)

  let igHandle = clean(body.igHandle, 80)
  if (igHandle && !igHandle.startsWith('@')) igHandle = '@' + igHandle

  // ── Every field, server side ──────────────────────────────────────────────
  // The browser validates too, but the browser is not the one that decides. The
  // whole premise of "complete the form to get the Venmo details" collapses if
  // an empty POST earns the credentials.
  const missing: string[] = []
  if (!contactName) missing.push('your name')
  if (!businessName) missing.push('business name')
  if (!email) missing.push('email')
  if (!phone) missing.push('phone')
  if (!productCategory) missing.push('what you sell')
  if (!productDescription) missing.push('a short description of your products')
  if (missing.length) {
    return NextResponse.json(
      { error: `Please fill in: ${missing.join(', ')}.` },
      { status: 400 },
    )
  }

  if (!looksLikeEmail(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }
  if (!looksLikePhone(phone)) {
    return NextResponse.json({ error: 'Please enter a phone number we can reach you on.' }, { status: 400 })
  }
  if (!(VENDOR_CATEGORIES as readonly string[]).includes(productCategory)) {
    return NextResponse.json({ error: 'Please choose a category from the list.' }, { status: 400 })
  }
  if (!isVendorPaymentMethod(paymentMethod)) {
    return NextResponse.json({ error: 'Please choose how you would like to pay.' }, { status: 400 })
  }

  const supabase = getSupabase()

  // ── One read answers both remaining questions ─────────────────────────────
  //
  // "Has this person already signed up?" and "is there a booth left?" are both
  // answered from the same handful of rows, so this is one round trip rather
  // than two, and the two answers cannot disagree with each other.
  //
  // Note what it does NOT do: filter on the email in the query. `.ilike()` is
  // banned on an email column in this codebase and the ban is correct — ilike
  // takes a PATTERN, not a string, so an address containing `%` matches rows it
  // has nothing to do with. That is not hypothetical: a `%` in an ilike
  // authorization filter is exactly how one portal session read 34 bookings.
  // Escaping the metacharacters would work until somebody edited the line.
  //
  // The comparison is done in JS on `lower()` instead, which is exact. It is
  // affordable because the row set is one market's registrations — a couple of
  // dozen at most, bounded by `boothCapacity` plus a waitlist.
  const { data: marketRows, error: rowsErr } = await supabase
    .from('market_vendors')
    .select('vendor_ref, email, status')
    .eq('market_slug', market.slug)
    .in('status', ['paid', 'pending_payment', 'waitlist'])
    .limit(500)

  if (rowsErr) {
    // Rule 12: proceeding on an unreadable table risks the double-charge this
    // check exists to prevent. Refuse rather than guess.
    console.error('market vendor: cannot read the registration list —', rowsErr.message)
    return NextResponse.json({ error: 'We could not reach the registration list. Please try again.' }, { status: 503 })
  }

  const rows = marketRows ?? []
  const wanted = email.toLowerCase()
  const existing = rows.filter(r => (r.email || '').toLowerCase() === wanted)

  if (existing.length > 0) {
    const row = existing[0]
    return NextResponse.json(
      {
        error:
          row.status === 'paid'
            ? `You're already registered — your vendor ref is ${row.vendor_ref}. Text us if you need to change anything.`
            : `We already have a registration started for this email (${row.vendor_ref}). Text us at ${market.venmoPhoneDisplay} and we'll finish it with you.`,
        vendorRef: row.vendor_ref,
        duplicate: true,
      },
      { status: 409 },
    )
  }

  // ── Is there a booth left? ────────────────────────────────────────────────
  //
  // This is check-then-act and I am choosing to accept the race rather than
  // paper over it. Link 7's session lock was the same shape and 12 concurrent
  // attempts counted as 3 — but that was a security control over 34 bookings,
  // and this is nine craft booths. Two vendors submitting inside the same
  // moment yields a tenth registration, which Adam resolves by moving one to
  // the waitlist and refunding $52.05. The alternative is a row-locking RPC for
  // a form that will see single-digit traffic in a month.
  //
  // What is NOT acceptable is silently overselling without noticing, so the
  // count is recorded on the row (`status_note`) at the moment it was taken.
  //
  // Counted from the rows already read above. A waitlisted registration does
  // NOT hold a booth, so it is excluded here even though it was included in the
  // duplicate check — those are two different questions about the same rows.
  const taken = rows.filter(r => r.status === 'paid' || r.status === 'pending_payment').length
  const isWaitlist = taken >= market.boothCapacity

  // Priced from the REGISTRY and the vendor's chosen method — never from the
  // browser, which sends no amount at all. A Venmo vendor owes the booth fee
  // and nothing else; the $2.05 is Stripe's cut being passed on, and Stripe is
  // not in the Venmo path.
  const { boothFeeCents, cardFeeCents, totalCents } = marketPricing(market, paymentMethod)

  const { data: inserted, error: insertErr } = await supabase
    .from('market_vendors')
    .insert({
      market_slug: market.slug,
      contact_name: contactName,
      business_name: businessName,
      ig_handle: igHandle || null,
      email,
      phone,
      product_category: productCategory,
      product_description: productDescription,
      needs_electricity: needsElectricity,
      booth_note: boothNote || null,
      payment_method: paymentMethod,
      booth_fee_cents: boothFeeCents,
      // The DB column is still `service_fee_cents` — renaming a live column is
      // not worth a migration for a field only this route writes. It holds the
      // CARD fee, and it is 0 on every Venmo row.
      service_fee_cents: cardFeeCents,
      total_cents: totalCents,
      // A waitlisted vendor is NOT asked for money. Taking the booth fee for a
      // booth that may not exist is the refund conversation this branch avoids.
      status: isWaitlist ? 'waitlist' : 'pending_payment',
      status_note: isWaitlist
        ? `Waitlisted on signup — ${taken} of ${market.boothCapacity} booths already taken.`
        : `Booth ${taken + 1} of ${market.boothCapacity} at signup.`,
    })
    .select('id, vendor_ref')
    .single()

  if (insertErr || !inserted) {
    console.error('market vendor: insert failed —', insertErr?.message)
    return NextResponse.json({ error: 'We could not save your registration. Please try again.' }, { status: 500 })
  }

  // ── Waitlist: no payment, just tell them ──────────────────────────────────
  if (isWaitlist) {
    return NextResponse.json({
      waitlist: true,
      vendorRef: inserted.vendor_ref,
      message:
        `All ${market.boothCapacity} booths are currently spoken for, so we have put you on the waitlist — ` +
        `we have NOT taken any payment. If a booth opens up we will call you first.`,
    })
  }

  // ── Venmo: the reveal ─────────────────────────────────────────────────────
  if (paymentMethod === 'venmo') {
    const note = `${market.shortName} booth — ${businessName}`
    return NextResponse.json({
      venmo: {
        handle: `@${market.venmoHandle}`,
        // The `?txn=pay&recipients=` form, NOT `venmo.com/<user>` — the profile
        // path 302s to account.venmo.com and drops the amount and note, so the
        // payment never prefills. See components/VenmoOption.tsx:28.
        deepLink:
          `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(market.venmoHandle)}` +
          `&amount=${(totalCents / 100).toFixed(2)}&note=${encodeURIComponent(note)}`,
        amount: (totalCents / 100).toFixed(2),
        note,
        confirmPhone: market.venmoPhoneDisplay,
        qrSrc: '/images/venmo-qr.png',
      },
      vendorRef: inserted.vendor_ref,
    })
  }

  // ── Card: Stripe Checkout ─────────────────────────────────────────────────
  const baseUrl = publicOrigin(req)
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: boothFeeCents,
            product_data: {
              name: `${market.name} — Vendor Booth`,
              description: `${businessName} · ${market.dateLabel}`,
            },
          },
          quantity: 1,
        },
        // Only reachable with `paymentMethod === 'card'`, so `cardFeeCents` is
        // non-zero here — but guarded anyway, because Stripe rejects a zero
        // `unit_amount` line and a future fee of 0 would turn every card
        // checkout into a 502 rather than a cheaper booth.
        ...(cardFeeCents > 0
          ? [{
              price_data: {
                currency: 'usd' as const,
                unit_amount: cardFeeCents,
                product_data: { name: 'Card processing fee' },
              },
              quantity: 1,
            }]
          : []),
      ],
      metadata: {
        type: 'market_vendor',
        vendorId: inserted.id,
        vendorRef: inserted.vendor_ref,
        marketSlug: market.slug,
        businessName,
        contactEmail: email,
      },
      success_url: `${baseUrl}/christmas-market/vendors/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/christmas-market/vendors?resumed=${inserted.vendor_ref}`,
    })

    // Attach the session so the webhook can find this row, and so an abandoned
    // checkout is still identifiable as "started to pay by card".
    const { error: linkErr } = await supabase
      .from('market_vendors')
      .update({ stripe_session_id: session.id })
      .eq('id', inserted.id)

    if (linkErr) {
      // The session exists and the vendor is about to pay through it. Losing the
      // link here would make the webhook unable to match the payment to the row,
      // so this is loud — but it is NOT fatal to the vendor's checkout, because
      // the metadata carries `vendorId` as the second way home.
      console.error(
        `market vendor ${inserted.vendor_ref}: could not attach stripe session ${session.id} —`,
        linkErr.message,
      )
    }

    return NextResponse.json({ url: session.url, vendorRef: inserted.vendor_ref })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    console.error('market vendor stripe error:', msg)
    // The row survives at `pending_payment` on purpose — the vendor's details
    // are captured even though the checkout never opened, which is the whole
    // reason the insert comes first.
    return NextResponse.json(
      { error: 'We saved your details but could not open the card checkout. Please try Venmo, or text us.' },
      { status: 502 },
    )
  }
}
