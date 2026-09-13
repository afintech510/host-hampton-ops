import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { mintPortalLink } from '@/lib/portalLinkMint'
import { formatMoney } from '@/lib/partyPricing'
import { partyApprovedHtml, partyChangesRequestedHtml, partyPortalMagicLinkHtml, partyPaymentReceivedHtml } from '@/lib/emailTemplates'
import { createCalendarEvent, addMinutes, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'
import { studioRentalRateWith, hoursBetween } from '@/lib/studioRental'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { draftForBookingByHand } from '@/lib/agent/manualDraft'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { sendCheckinLinkSms } from '@/lib/checkinLink'
import { enqueueCheckinReminders, cancelCheckinReminders } from '@/lib/checkinReminders'
import { readBalanceInputs, computeBalance, sumPayments } from '@/lib/bookingBalance'
import { billedTotalCents } from '@/lib/planBalance'
import { logBookingChange } from '@/lib/bookingAudit'
import {
  recordAdminPayment,
  describeLedgerOutcome,
  ledgerCategoryForBooking,
  ADMIN_PAYMENT_METHODS,
  PAYMENT_TYPES,
  type AdminPaymentMethod,
  type PaymentType,
} from '@/lib/adminMoney'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const [bookingRes, lineItemsRes, paymentsRes, modificationsRes] = await Promise.all([
    supabase.from('bookings').select('*').eq('id', id).single(),
    supabase.from('booking_line_items').select('*').eq('booking_id', id).order('sort_order'),
    supabase.from('booking_payments').select('*').eq('booking_id', id).order('paid_at', { ascending: false }),
    supabase.from('booking_modifications').select('*').eq('booking_id', id).order('created_at', { ascending: false }),
  ])

  if (bookingRes.error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ...bookingRes.data,
    line_items: lineItemsRes.data || [],
    payments: paymentsRes.data || [],
    modifications: modificationsRes.data || [],
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()

  // Admin can update any field
  const updates: Record<string, unknown> = {}
  const allowed = ['status', 'party_date', 'party_time', 'package_type', 'guest_count_approx', 'child_name', 'child_age', 'total_cents', 'balance_due_cents', 'admin_notes', 'notes', 'contact_name', 'contact_email', 'contact_phone', 'photo_gallery_url', 'party_tags']
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const { error } = await supabase.from('bookings').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Admin edit: ' + Object.keys(updates).filter(k => k !== 'updated_at').join(', '),
      newData: updates,
    })

  // Date changes are free, so they happen often. Both check-in texts are
  // scheduled off the party start, so they have to move with it — otherwise a
  // rescheduled party texts its customer on the old date.
  if (updates.party_date !== undefined || updates.party_time !== undefined) {
    const { data: fresh } = await supabase
      .from('bookings')
      .select('booking_ref, contact_email, party_date, party_time, checkin_status')
      .eq('id', id)
      .single()

    // Nothing to reschedule once check-in is done.
    if (fresh && fresh.checkin_status !== 'complete') {
      await enqueueCheckinReminders({
        bookingRef: fresh.booking_ref,
        contactEmail: fresh.contact_email,
        partyDate: fresh.party_date,
        partyTime: fresh.party_time,
      })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()
  const action = body.action as string

  // Three outcomes, not two. This one read gates every admin action below —
  // approve, cancel, record a payment, send a portal link, edit a line item — and
  // it used to discard its error, so a transient Supabase failure answered a
  // confident **404 "Not found"** about a party that is sitting right there.
  // Hard-won rule 12; link 14 found eleven of these in one surface.
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (bookingErr) {
    console.error(`admin/parties/${id}: booking read failed:`, bookingErr.message)
    return NextResponse.json(
      { error: 'Could not load this party right now — please try again.' },
      { status: 503 },
    )
  }
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })


  // ── "Draft reply with agent" (Phase 4 item 5) ─────────────────────────
  // The button that covers a phone lead: it enqueues an inbound event for this
  // plan and takes it through the SAME claim path as any other event, so the
  // cron and a button press can never both draft it. See lib/agent/manualDraft.ts
  // for the three layers that stop a double-click becoming two texts. This is
  // an admin-authenticated route, but drafting still only reaches `sent_for_review`
  // — the 'approved' and 'sent' edges stay gated exactly as before.
  if (action === 'draft_with_agent') {
    const result = await draftForBookingByHand({
      supabase,
      bookingId: id,
      // Plan §11.1: `admin:<email>` when a session names the human, and the
      // historical anonymous 'ADMIN' on the shared password. This is the actor
      // the event and the ledger carry, so "who asked the agent to draft this"
      // is answerable once both admins sign in per-person.
      actor: adminActorId(req),
      note: typeof body.note === 'string' ? body.note : null,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, reason: result.reason, reviewCode: result.reviewCode ?? null },
        { status: result.status },
      )
    }
    return NextResponse.json({
      ok: true,
      reviewCode: result.reviewCode,
      draftId: result.draftId,
      draftStatus: result.draftStatus,
      reviewersTexted: result.reviewersTexted,
      // Nothing has reached the customer; this only texted the reviewers.
      sentToCustomer: false,
    })
  }

  if (action === 'approve') {
    // Approving emails the customer "Your Party is Confirmed!". Doing that over
    // a status write that was refused tells a real family their party is booked
    // when the database still says it is pending (rule 10).
    const { data: approved, error: approveErr } = await supabase.from('bookings').update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: adminActorId(req),
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('id')
    if (approveErr || !approved?.length) {
      return NextResponse.json(
        { error: `Booking NOT approved: ${approveErr?.message || 'no row matched'}. Nothing was sent to the customer.` },
        { status: 500 },
      )
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Booking approved',
    })

    // Create GCal event
    if (booking.party_date && booking.party_time) {
      const endTime = addMinutes(booking.party_time, 120)
      await createCalendarEvent({
        summary: `[PARTY] ${booking.contact_name} - ${booking.package_type || 'Party'}`,
        startDate: booking.party_date,
        startTime: booking.party_time,
        endTime,
        description: `Ref: ${booking.booking_ref}\nGuests: ~${booking.guest_count_approx}\n${booking.child_name ? `Child: ${booking.child_name}` : ''}`,
      }).catch(err => console.error('GCal error:', err))
    }

    // Generate portal link & send approval email
    const minted = await mintPortalLink(supabase, id, booking.booking_ref)
    if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
    const portalUrl = minted.url

    const partyDateFormatted = booking.party_date
      ? new Date(booking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'TBD'

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
        from, to: booking.contact_email,
        subject: `Your Party is Confirmed! — ${booking.booking_ref}`,
        html: partyApprovedHtml({
          customerName: booking.contact_name,
          bookingRef: booking.booking_ref,
          partyDate: partyDateFormatted,
          partyTime: booking.party_time || 'TBD',
          balanceFormatted: formatMoney(booking.balance_due_cents || 0),
          portalUrl,
        }),
      })
    }

    return NextResponse.json({ ok: true, action: 'approved' })
  }

  if (action === 'request_changes') {
    const message = body.message || 'Please review your booking details.'

    if (process.env.RESEND_API_KEY) {
      const minted = await mintPortalLink(supabase, id, booking.booking_ref)
      if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
      const portalUrl = minted.url

      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
        from, to: booking.contact_email,
        subject: `Update About Your Booking — ${booking.booking_ref}`,
        html: partyChangesRequestedHtml({
          customerName: booking.contact_name,
          bookingRef: booking.booking_ref,
          adminMessage: message,
          portalUrl,
        }),
      })
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Changes requested: ${message}`,
    })

    return NextResponse.json({ ok: true, action: 'changes_requested' })
  }

  if (action === 'cancel') {
    // A cancel that reports success over a refused write leaves a party live in
    // the calendar, in the pipeline and — since the check-in reminders are
    // cancelled below on the strength of it — with its customer still due to be
    // texted about a party that Allie believes is off.
    const { data: cancelled, error: cancelErr } = await supabase.from('bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', id).select('id')
    if (cancelErr || !cancelled?.length) {
      return NextResponse.json(
        { error: `Booking NOT cancelled: ${cancelErr?.message || 'no row matched'}` },
        { status: 500 },
      )
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Booking cancelled by admin',
    })

    // Don't text a cancelled party's customer asking them to check in.
    await cancelCheckinReminders(booking.booking_ref)

    return NextResponse.json({ ok: true, action: 'cancelled' })
  }

  // ── "Record a payment" — the one place a human puts money in the books ──
  //
  // This is where the cash, Venmo, Zelle and cheque money arrives: Stripe never
  // sees it, so the webhook cannot record it and the rule "only the webhook
  // records a payment" cannot apply. Before link 18 this action wrote a
  // `booking_payments` row and NOTHING ELSE — no `financial_transactions` row,
  // ever — so $2,256 of real customer money, $1,608 of it non-card, is in the
  // database and has never appeared in the Financials tab Adam reads.
  //
  // Four failure modes were live here and all four are fixed below:
  //   * the INSERT's error was discarded, and the customer was then emailed
  //     "Payment Received — $X, balance $Y" over a write that may have been
  //     refused (rule 19, then rule 10's expensive half);
  //   * the balance came from `booking.total_cents || 0` over a read whose error
  //     was also discarded, so an UNQUOTED LEAD — most of the pipeline since
  //     Phase 4 — was marked `paid_in_full` by its first deposit (rule 12);
  //   * `recorded_by` was the literal `'admin'`, so the money row could not name
  //     the human who entered it (migration 047 relaxes the CHECK);
  //   * `amount_cents` reached the column unvalidated.
  if (action === 'record_payment') {
    const { amount_cents, payment_method, notes: payNotes, force_ledger } = body

    if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0) {
      return NextResponse.json(
        { error: 'amount_cents must be a positive whole number of cents' },
        { status: 400 },
      )
    }
    if (typeof payment_method !== 'string' || !ADMIN_PAYMENT_METHODS.includes(payment_method as AdminPaymentMethod)) {
      return NextResponse.json(
        { error: `payment_method must be one of: ${ADMIN_PAYMENT_METHODS.join(', ')}` },
        { status: 400 },
      )
    }
    const paymentType: PaymentType =
      typeof body.payment_type === 'string' && PAYMENT_TYPES.includes(body.payment_type as PaymentType)
        ? (body.payment_type as PaymentType)
        : 'partial'

    // `.select()` so a refused INSERT is a refusal and not a silent success. The
    // customer receipt below depends on this row existing.
    const { data: paymentRow, error: payErr } = await supabase
      .from('booking_payments')
      .insert({
        booking_id: id,
        payment_type: paymentType,
        payment_method,
        amount_cents,
        card_fee_cents: 0,
        total_charged_cents: amount_cents,
        recorded_by: adminActorId(req),
        notes: payNotes || null,
      })
      .select('id, paid_at')
      .single()

    if (payErr || !paymentRow) {
      console.error(`record_payment: booking_payments insert failed for ${booking.booking_ref}:`, payErr?.message)
      return NextResponse.json(
        { error: `Payment NOT recorded: ${payErr?.message || 'insert returned no row'}` },
        { status: 500 },
      )
    }

    // Recalculate the balance from the shared reader (lib/bookingBalance.ts),
    // which the Stripe webhook also uses. A failed read is reported, never
    // treated as a zero total.
    const inputs = await readBalanceInputs(supabase, id, 'total_cents')
    let newBalance: number | null = null
    let balanceNote = ''
    if (!inputs.ok) {
      console.error(`record_payment: balance NOT updated for ${booking.booking_ref}: ${inputs.message}`)
      balanceNote = ` Balance NOT recalculated (${inputs.message}).`
    } else {
      const bal = computeBalance(inputs.row.total_cents as number | null, inputs.paidSum)
      newBalance = bal.balanceCents
      const updateFields: Record<string, unknown> = {
        balance_due_cents: bal.balanceCents,
        updated_at: new Date().toISOString(),
      }
      if (bal.paidInFull) {
        updateFields.paid_in_full_at = new Date().toISOString()
        updateFields.status = 'paid_in_full'
      }
      const { data: updated, error: updErr } = await supabase
        .from('bookings')
        .update(updateFields)
        .eq('id', id)
        .select('id')
      if (updErr || !updated?.length) {
        console.error(`record_payment: bookings update matched nothing for ${booking.booking_ref}:`, updErr?.message)
        balanceNote = ` Balance NOT saved (${updErr?.message || 'no row matched'}).`
        newBalance = null
      } else if (bal.overpaidCents > 0) {
        balanceNote = ` OVERPAID by ${formatMoney(bal.overpaidCents)}.`
      }
    }

    // Into the books. Declines rather than double-counting when a Stripe row
    // already records this amount for this booking — see lib/adminMoney.ts.
    const ledger = await recordAdminPayment(supabase, {
      paymentId: paymentRow.id,
      bookingRef: booking.booking_ref,
      amountCents: amount_cents,
      method: payment_method,
      paidAt: paymentRow.paid_at || new Date().toISOString(),
      customerName: booking.contact_name || null,
      category: ledgerCategoryForBooking(booking.party_type, booking.event_type),
      notes: payNotes || null,
      force: force_ledger === true,
    })
    const ledgerNote = describeLedgerOutcome(ledger)

    // `logBookingChange` reports its own failure; the payment itself stands
    // either way, so this is not a reason to refuse.
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `${payment_method} payment of ${formatMoney(amount_cents)} recorded. ` +
        `Balance: ${newBalance === null ? 'unchanged' : formatMoney(newBalance)}.${balanceNote} ${ledgerNote}`,
    })

    // Send customer receipt — only now, with a real payment row behind it.
    if (process.env.RESEND_API_KEY && booking.contact_email) {
      // A link whose token row was refused is a dead link in a customer's
      // inbox, so the mint decides whether the email goes at all.
      const minted = await mintPortalLink(supabase, id, booking.booking_ref)
      if (minted.ok) {
        const portalUrl = minted.url
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const { error: mailErr } = await resend.emails.send({
          from, to: booking.contact_email,
          subject: `Payment Received — ${booking.booking_ref}`,
          html: partyPaymentReceivedHtml({
            customerName: booking.contact_name,
            bookingRef: booking.booking_ref,
            amountFormatted: formatMoney(amount_cents),
            paymentMethod: payment_method,
            newBalanceFormatted: newBalance === null ? 'see your portal' : formatMoney(newBalance),
            portalUrl,
          }),
        })
        if (mailErr) console.error('record_payment: receipt email failed:', mailErr.message)
      }
    }

    return NextResponse.json({
      ok: true,
      action: 'payment_recorded',
      paymentId: paymentRow.id,
      newBalance,
      balanceUpdated: newBalance !== null,
      ledger: ledger.kind,
      ledgerReference: ledger.reference,
      message: `Payment of ${formatMoney(amount_cents)} recorded.${balanceNote} ${ledgerNote}`,
    })
  }

  if (action === 'send_portal_link' || action === 'generate_portal_url') {
    const minted = await mintPortalLink(supabase, id, booking.booking_ref)
    if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
    const portalUrl = minted.url

    // send_portal_link delivers the link to the customer by BOTH email and SMS
    // (sharing this single token); generate_portal_url just mints the URL.
    if (action === 'send_portal_link') {
      const sentVia: string[] = []

      if (booking.contact_email && process.env.RESEND_API_KEY) {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        await resend.emails.send({
          from, to: booking.contact_email,
          subject: `Your Booking Portal Link — ${booking.booking_ref}`,
          html: partyPortalMagicLinkHtml({
            customerName: booking.contact_name,
            bookingRef: booking.booking_ref,
            portalUrl,
          }),
        })
        sentVia.push('email')
      }

      if (booking.contact_phone) {
        const firstName = (booking.contact_name || '').trim().split(/\s+/)[0] || 'there'
        const smsBody = `Hi ${firstName}! Here's your Host Hampton party booking link to review details & pay your deposit: ${portalUrl} Reply STOP to opt out`
        const sid = await sendSMSVia('quo', normalizePhone(booking.contact_phone), smsBody)
        if (sid) sentVia.push('sms')
      }

      await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: sentVia.length
          ? `Portal link sent to customer via ${sentVia.join(' + ')}`
          : 'Portal link generated (no email/SMS delivery — check contact info & config)',
    })

      return NextResponse.json({ ok: true, action: 'portal_link_sent', portalUrl, sentVia })
    }

    return NextResponse.json({ ok: true, action: 'portal_url_generated', portalUrl })
  }

  // Text the customer a fresh portal link. Transactional → Quo.
  if (action === 'send_portal_sms') {
    if (!booking.contact_phone) {
      return NextResponse.json({ error: 'No phone number on file for this booking' }, { status: 400 })
    }

    const minted = await mintPortalLink(supabase, id, booking.booking_ref)
    if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
    const portalUrl = minted.url

    const firstName = (booking.contact_name || '').trim().split(/\s+/)[0] || 'there'
    const smsBody = `Hi ${firstName}! Here's your Host Hampton party booking link to review details & pay your deposit: ${portalUrl} Reply STOP to opt out`

    const sid = await sendSMSVia('quo', normalizePhone(booking.contact_phone), smsBody)
    if (!sid) {
      return NextResponse.json({ error: 'Failed to send SMS — check the phone number and Quo/SMS config' }, { status: 502 })
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Portal link texted to ${booking.contact_phone}`,
    })

    return NextResponse.json({ ok: true, action: 'portal_sms_sent', to: booking.contact_phone })
  }

  // Text the customer their pre-arrival check-in link. Any staff may do this.
  if (action === 'send_checkin_link') {
    if (!booking.contact_phone) {
      return NextResponse.json({ error: 'No phone number on file for this booking' }, { status: 400 })
    }

    let result
    try {
      result = await sendCheckinLinkSms(booking)
    } catch (err) {
      console.error('admin:send_checkin_link error:', err)
      return NextResponse.json({ error: 'Could not generate the check-in link' }, { status: 500 })
    }

    if (!result.sent) {
      return NextResponse.json(
        { error: `Failed to send check-in link — ${result.reason}` },
        { status: 502 },
      )
    }

    // Make sure the automatic sends exist too. A booking created before this
    // feature shipped has no reminder rows; this backfills them on first send.
    await enqueueCheckinReminders({
      bookingRef: booking.booking_ref,
      contactEmail: booking.contact_email,
      partyDate: booking.party_date,
      partyTime: booking.party_time,
    })

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Check-in link texted to ${booking.contact_phone}`,
    })

    return NextResponse.json({ ok: true, action: 'checkin_link_sent', to: booking.contact_phone })
  }

  if (action === 'delete_booking') {
    // Hard delete — children (line items, payments, modifications, portal tokens)
    // cascade automatically. Used to purge test/duplicate bookings.
    const evId = booking.google_calendar_event_id as string | null
    if (evId) await deleteCalendarEvent(evId).catch(() => {})

    const { error } = await supabase.from('bookings').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, action: 'booking_deleted' })
  }

  if (action === 'add_line_item') {
    const { name, category, quantity, unit_price_cents, guest_multiplied } = body
    if (!name || unit_price_cents === undefined) {
      return NextResponse.json({ error: 'name and unit_price_cents required' }, { status: 400 })
    }

    const maxSort = (await supabase
      .from('booking_line_items')
      .select('sort_order')
      .eq('booking_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()
    ).data?.sort_order ?? 0

    const { error: liErr } = await supabase.from('booking_line_items').insert({
      booking_id: id,
      name,
      category: category || (unit_price_cents < 0 ? 'discount' : 'add-on'),
      quantity: quantity || 1,
      unit_price_cents,
      price_type: guest_multiplied ? 'per_person' : 'flat',
      guest_multiplied: !!guest_multiplied,
      sort_order: maxSort + 1,
    })
    // This changes the invoice. Answering `{ok:true}` over a refused insert is
    // the version of rule 10 that costs money.
    if (liErr) {
      return NextResponse.json({ error: `Line item NOT added: ${liErr.message}` }, { status: 500 })
    }

    const totals = await recalcTotals(supabase, id, booking)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Added line item: ${name} (${formatMoney(unit_price_cents)})` +
        (totals.ok ? ` — total now ${formatMoney(totals.totalCents)}` : ` — TOTAL NOT RECALCULATED (${totals.message})`),
    })

    return NextResponse.json({
      ok: true,
      action: 'line_item_added',
      totalsUpdated: totals.ok,
      ...(totals.ok ? { totalCents: totals.totalCents, balanceCents: totals.balanceCents } : { warning: `The line item was added but the invoice total could not be recalculated (${totals.message}). Reload before quoting this customer.` }),
    })
  }

  if (action === 'remove_line_item') {
    const { line_item_id } = body
    if (!line_item_id) return NextResponse.json({ error: 'line_item_id required' }, { status: 400 })

    // Three outcomes (rule 12): a failed read is not "no such line item".
    const { data: li, error: liReadErr } = await supabase
      .from('booking_line_items')
      .select('name')
      .eq('id', line_item_id)
      .eq('booking_id', id)
      .maybeSingle()

    if (liReadErr) {
      return NextResponse.json(
        { error: `Could not load that line item (${liReadErr.message}) — nothing was removed.` },
        { status: 503 },
      )
    }
    if (!li) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

    // Scoped to this booking as well as the id — the read was, and the delete
    // was not, so a line_item_id belonging to another party would have been
    // deleted by a caller who could not even see it.
    const { data: removed, error: delErr } = await supabase
      .from('booking_line_items')
      .delete()
      .eq('id', line_item_id)
      .eq('booking_id', id)
      .select('id')
    if (delErr) {
      return NextResponse.json({ error: `Line item NOT removed: ${delErr.message}` }, { status: 500 })
    }
    if (!removed?.length) {
      return NextResponse.json({ error: 'Line item not found' }, { status: 404 })
    }

    const totals = await recalcTotals(supabase, id, booking)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Removed line item: ${li.name}` +
        (totals.ok ? ` — total now ${formatMoney(totals.totalCents)}` : ` — TOTAL NOT RECALCULATED (${totals.message})`),
    })

    return NextResponse.json({
      ok: true,
      action: 'line_item_removed',
      totalsUpdated: totals.ok,
      ...(totals.ok ? { totalCents: totals.totalCents, balanceCents: totals.balanceCents } : { warning: `The line item was removed but the invoice total could not be recalculated (${totals.message}).` }),
    })
  }

  // Studio rental: change start/end time → re-price the rental fee + recompute balance.
  if (action === 'edit_rental') {
    if (booking.event_type !== 'studio-rental') {
      return NextResponse.json({ error: 'Not a studio rental booking' }, { status: 400 })
    }
    const startTime = body.startTime as string
    const endTime = body.endTime as string
    if (!startTime || !endTime) return NextResponse.json({ error: 'startTime and endTime required' }, { status: 400 })
    const hours = hoursBetween(startTime, endTime)
    const { studioRates } = await loadPricingCatalog()
    if (hours < studioRates.minHours) {
      return NextResponse.json({ error: `Minimum rental is ${studioRates.minHours} hours` }, { status: 400 })
    }
    const rate = studioRentalRateWith(studioRates, booking.party_date as string, hours)

    // Update (or create) the rental line item.
    const { data: rentalLi } = await supabase
      .from('booking_line_items').select('id').eq('booking_id', id).eq('category', 'rental').limit(1).maybeSingle()
    // Re-pricing a studio rental IS the quote. A refused write here with a
    // `{ok:true}` answer means the admin believes they changed the price and the
    // customer's invoice still says the old one.
    const rentalWrite = rentalLi
      ? await supabase.from('booking_line_items').update({
          name: rate.lineItemLabel, unit_price_cents: rate.rentalCents, quantity: 1, guest_multiplied: false,
        }).eq('id', rentalLi.id).select('id')
      : await supabase.from('booking_line_items').insert({
          booking_id: id, name: rate.lineItemLabel, category: 'rental', quantity: 1,
          unit_price_cents: rate.rentalCents, price_type: 'flat', guest_multiplied: false, sort_order: 0,
        }).select('id')
    if (rentalWrite.error || !rentalWrite.data?.length) {
      return NextResponse.json(
        { error: `Rental fee NOT updated: ${rentalWrite.error?.message || 'no row matched'}` },
        { status: 500 },
      )
    }

    // Update times on the booking + party_tags.
    const tags = (booking.party_tags as Record<string, unknown> | null) || {}
    await supabase.from('bookings').update({
      party_time: startTime,
      party_tags: { ...tags, rental_start_time: startTime, rental_end_time: endTime, rental_hours: rate.hours, is_weekend: rate.isWeekend },
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    await recalcTotals(supabase, id, booking)

    // Update the calendar block.
    const summary = `[STUDIO RENTAL] ${booking.contact_name || 'Rental'} — ${(tags.event_label as string) || 'Event'}`
    const desc = `Ref: ${booking.booking_ref}\nContact: ${booking.contact_name || ''}\nGuests: ~${booking.guest_count_approx || ''}\nUpdated by admin`
    const evId = booking.google_calendar_event_id as string | null
    if (evId) {
      await updateCalendarEvent(evId, { startDate: booking.party_date as string, startTime, endTime, summary, description: desc }).catch(() => {})
    } else {
      const newId = await createCalendarEvent({ summary, startDate: booking.party_date as string, startTime, endTime, description: desc }).catch(() => null)
      if (newId) await supabase.from('bookings').update({ google_calendar_event_id: newId }).eq('id', id)
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Rental time → ${startTime}–${endTime} (${rate.hours} hrs); rental fee ${formatMoney(rate.rentalCents)}`,
    })

    return NextResponse.json({ ok: true, action: 'rental_edited', rentalCents: rate.rentalCents, hours: rate.hours })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/**
 * Re-derive `total_cents` and `balance_due_cents` from the line items.
 *
 * The version this replaces discarded BOTH read errors, and that is worse here
 * than anywhere else on the surface: a failed `booking_line_items` read left
 * `items` null, the loop added nothing, and the function then **wrote
 * `total_cents: 0` and `balance_due_cents: 0` over the booking**. So a Supabase
 * blip while an admin added a decoration line item did not merely mis-read the
 * invoice — it ZEROED a real customer's invoice, and answered `{ok: true}`.
 *
 * Link 16 found the read-becomes-a-balance shape on four webhook branches; this
 * is the same rule 12 defect with an overwrite behind it. Three outcomes now,
 * and a failed read writes nothing at all.
 */
async function recalcTotals(
  supabase: ReturnType<typeof getSupabase>,
  bookingId: string,
  booking: Record<string, unknown>,
): Promise<{ ok: true; totalCents: number; balanceCents: number } | { ok: false; message: string }> {
  const { data: items, error: itemsErr } = await supabase
    .from('booking_line_items')
    .select('unit_price_cents, quantity, guest_multiplied, is_optional')
    .eq('booking_id', bookingId)
  if (itemsErr) {
    console.error(`recalcTotals: line items unreadable for ${bookingId} — totals NOT rewritten:`, itemsErr.message)
    return { ok: false, message: `line items unreadable: ${itemsErr.message}` }
  }

  // `billedTotalCents` is the same function `loadPlanInvoice` totals the
  // document with. This loop used to be its own copy and it did not select
  // `is_optional`, let alone honour it — so an admin saving a booking that
  // carried a quoted-but-not-charged add-on rewrote `total_cents` to INCLUDE it,
  // and the stored total then disagreed with the invoice the customer holds.
  // Only the cancelled HH-TEST-PAY1/PAY2 rows carry optional items today, so no
  // real booking has been inflated — but every writer on this surface could.
  const total = billedTotalCents(
    (items || []) as { unit_price_cents: number; quantity: number; guest_multiplied: boolean; is_optional?: boolean }[],
    booking.guest_count_approx as number | null,
  )

  const { data: payments, error: payErr } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', bookingId)
  if (payErr) {
    console.error(`recalcTotals: payments unreadable for ${bookingId} — totals NOT rewritten:`, payErr.message)
    return { ok: false, message: `payments unreadable: ${payErr.message}` }
  }

  const balance = Math.max(0, total - sumPayments(payments))
  const { data: updated, error: updErr } = await supabase.from('bookings').update({
    total_cents: total,
    balance_due_cents: balance,
    updated_at: new Date().toISOString(),
  }).eq('id', bookingId).select('id')
  if (updErr || !updated?.length) {
    console.error(`recalcTotals: totals NOT saved for ${bookingId}:`, updErr?.message || 'no row matched')
    return { ok: false, message: updErr?.message || 'no booking row matched' }
  }

  return { ok: true, totalCents: total, balanceCents: balance }
}
