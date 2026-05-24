import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { formatMoney } from '@/lib/partyPricing'
import { partyApprovedHtml, partyChangesRequestedHtml, partyPortalMagicLinkHtml, partyPaymentReceivedHtml } from '@/lib/emailTemplates'
import { createCalendarEvent, addMinutes } from '@/lib/googleCalendar'

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
  const allowed = ['status', 'party_date', 'party_time', 'package_type', 'guest_count_approx', 'child_name', 'child_age', 'total_cents', 'balance_due_cents', 'admin_notes', 'notes', 'contact_name', 'contact_email', 'contact_phone', 'photo_gallery_url']
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const { error } = await supabase.from('bookings').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('booking_modifications').insert({
    booking_id: id,
    modified_by: 'admin',
    change_summary: 'Admin edit: ' + Object.keys(updates).filter(k => k !== 'updated_at').join(', '),
    new_data: updates,
  })

  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()
  const action = body.action as string

  const { data: booking } = await supabase.from('bookings').select('*').eq('id', id).single()
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'

  if (action === 'approve') {
    await supabase.from('bookings').update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: 'admin',
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    await supabase.from('booking_modifications').insert({
      booking_id: id, modified_by: 'admin', change_summary: 'Booking approved',
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
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, secret)
    await supabase.from('portal_tokens').insert({ booking_id: id, token_hash: hash, expires_at: expiresAt.toISOString() })
    const portalUrl = buildPortalUrl(booking.booking_ref, rawToken)

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
      const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
      const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, secret)
      await supabase.from('portal_tokens').insert({ booking_id: id, token_hash: hash, expires_at: expiresAt.toISOString() })
      const portalUrl = buildPortalUrl(booking.booking_ref, rawToken)

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

    await supabase.from('booking_modifications').insert({
      booking_id: id, modified_by: 'admin', change_summary: `Changes requested: ${message}`,
    })

    return NextResponse.json({ ok: true, action: 'changes_requested' })
  }

  if (action === 'cancel') {
    await supabase.from('bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', id)

    await supabase.from('booking_modifications').insert({
      booking_id: id, modified_by: 'admin', change_summary: 'Booking cancelled by admin',
    })

    return NextResponse.json({ ok: true, action: 'cancelled' })
  }

  if (action === 'record_payment') {
    const { amount_cents, payment_method, notes: payNotes } = body
    if (!amount_cents || !payment_method) {
      return NextResponse.json({ error: 'amount_cents and payment_method required' }, { status: 400 })
    }

    await supabase.from('booking_payments').insert({
      booking_id: id,
      payment_type: 'partial',
      payment_method,
      amount_cents,
      card_fee_cents: 0,
      total_charged_cents: amount_cents,
      recorded_by: 'admin',
      notes: payNotes || null,
    })

    // Recalculate balance
    const { data: payments } = await supabase
      .from('booking_payments')
      .select('amount_cents, payment_type')
      .eq('booking_id', id)

    let paid = 0
    for (const p of (payments || [])) {
      if (p.payment_type === 'refund') paid -= p.amount_cents
      else paid += p.amount_cents
    }
    const newBalance = Math.max(0, (booking.total_cents || 0) - paid)
    const updateFields: Record<string, unknown> = { balance_due_cents: newBalance, updated_at: new Date().toISOString() }
    if (newBalance === 0) {
      updateFields.paid_in_full_at = new Date().toISOString()
      updateFields.status = 'paid_in_full'
    }
    await supabase.from('bookings').update(updateFields).eq('id', id)

    await supabase.from('booking_modifications').insert({
      booking_id: id, modified_by: 'admin',
      change_summary: `${payment_method} payment of ${formatMoney(amount_cents)} recorded. Balance: ${formatMoney(newBalance)}`,
    })

    // Send customer receipt
    if (process.env.RESEND_API_KEY) {
      const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
      const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, secret)
      await supabase.from('portal_tokens').insert({ booking_id: id, token_hash: hash, expires_at: expiresAt.toISOString() })
      const portalUrl = buildPortalUrl(booking.booking_ref, rawToken)

      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
        from, to: booking.contact_email,
        subject: `Payment Received — ${booking.booking_ref}`,
        html: partyPaymentReceivedHtml({
          customerName: booking.contact_name,
          bookingRef: booking.booking_ref,
          amountFormatted: formatMoney(amount_cents),
          paymentMethod: payment_method,
          newBalanceFormatted: formatMoney(newBalance),
          portalUrl,
        }),
      })
    }

    return NextResponse.json({ ok: true, action: 'payment_recorded', newBalance })
  }

  if (action === 'send_portal_link' || action === 'generate_portal_url') {
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, secret)
    await supabase.from('portal_tokens').insert({ booking_id: id, token_hash: hash, expires_at: expiresAt.toISOString() })
    const portalUrl = buildPortalUrl(booking.booking_ref, rawToken)

    if (action === 'send_portal_link' && process.env.RESEND_API_KEY) {
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
    }

    return NextResponse.json({ ok: true, action: action === 'send_portal_link' ? 'portal_link_sent' : 'portal_url_generated', portalUrl })
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

    await supabase.from('booking_line_items').insert({
      booking_id: id,
      name,
      category: category || (unit_price_cents < 0 ? 'discount' : 'add-on'),
      quantity: quantity || 1,
      unit_price_cents,
      price_type: guest_multiplied ? 'per_person' : 'flat',
      guest_multiplied: !!guest_multiplied,
      sort_order: maxSort + 1,
    })

    await recalcTotals(supabase, id, booking)

    await supabase.from('booking_modifications').insert({
      booking_id: id, modified_by: 'admin',
      change_summary: `Added line item: ${name} (${formatMoney(unit_price_cents)})`,
    })

    return NextResponse.json({ ok: true, action: 'line_item_added' })
  }

  if (action === 'remove_line_item') {
    const { line_item_id } = body
    if (!line_item_id) return NextResponse.json({ error: 'line_item_id required' }, { status: 400 })

    const { data: li } = await supabase
      .from('booking_line_items')
      .select('name')
      .eq('id', line_item_id)
      .eq('booking_id', id)
      .single()

    if (!li) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

    await supabase.from('booking_line_items').delete().eq('id', line_item_id)
    await recalcTotals(supabase, id, booking)

    await supabase.from('booking_modifications').insert({
      booking_id: id, modified_by: 'admin',
      change_summary: `Removed line item: ${li.name}`,
    })

    return NextResponse.json({ ok: true, action: 'line_item_removed' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

async function recalcTotals(supabase: ReturnType<typeof getSupabase>, bookingId: string, booking: Record<string, unknown>) {
  const { data: items } = await supabase
    .from('booking_line_items')
    .select('unit_price_cents, quantity, guest_multiplied')
    .eq('booking_id', bookingId)

  const guestCount = (booking.guest_count_approx as number) || 1
  let total = 0
  for (const li of items || []) {
    total += li.guest_multiplied
      ? li.unit_price_cents * li.quantity * guestCount
      : li.unit_price_cents * li.quantity
  }

  const { data: payments } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', bookingId)

  let paid = 0
  for (const p of payments || []) {
    if (p.payment_type === 'refund') paid -= p.amount_cents
    else paid += p.amount_cents
  }

  const balance = Math.max(0, total - paid)
  await supabase.from('bookings').update({
    total_cents: total,
    balance_due_cents: balance,
    updated_at: new Date().toISOString(),
  }).eq('id', bookingId)
}
