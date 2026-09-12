import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { upsertContact } from '@/lib/contacts'
import { computeCutoffDates, generatePartyRef, formatMoney } from '@/lib/partyPricing'
import { buildPlanSnapshot, planTotals, writeLineItems } from '@/lib/plan'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { partyQuoteSentHtml } from '@/lib/emailTemplates'
import type { BookingLineItem } from '@/types/booking-flow'
import { publicOrigin } from '@/lib/publicOrigin'

function formatDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  } catch { return timeStr }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  try {
    const body = await req.json()
    const {
      contactName, contactEmail, contactPhone, childName,
      partyDate, partyTime, guestCount, packageType,
      lineItems = [], notes, sendEmail = true, lockDate = true,
    } = body as {
      contactName: string
      contactEmail: string
      contactPhone?: string
      childName?: string
      partyDate?: string
      partyTime?: string
      guestCount?: number
      packageType?: string
      lineItems?: BookingLineItem[]
      notes?: string
      sendEmail?: boolean
      lockDate?: boolean
    }

    if (!contactName || !contactEmail) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    const supabase = getSupabase()
    const origin = publicOrigin(req)
    const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const guests = guestCount || 10
    const cutoffs = partyDate ? computeCutoffDates(partyDate) : null
    const bookingRef = generatePartyRef()

    const partyTags = {
      date_locked: !!lockDate,
      created_by: 'admin',
      created_at: new Date().toISOString(),
    }

    const snapshot = buildPlanSnapshot({ lineItems, guestCount: guests, packageType })
    const { total_cents: totalCents, deposit_amount: depositCents, balance_due_cents: balanceDueCents } =
      planTotals(snapshot)

    const { data: booking, error: dbErr } = await supabase.from('bookings').insert({
      booking_ref: bookingRef,
      status: 'awaiting_deposit',
      event_type: 'kid-party',
      party_date: partyDate || null,
      party_time: partyTime || null,
      package_type: packageType || null,
      guest_count_approx: guests,
      child_name: childName || null,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      deposit_amount: depositCents,
      total_cents: totalCents,
      balance_due_cents: balanceDueCents,
      card_fee_rate: 0.03,
      modification_cutoff: cutoffs?.modificationCutoff || null,
      guest_count_cutoff: cutoffs?.guestCountCutoff || null,
      party_type: 'in_studio_theme',
      source: 'admin',
      quote_snapshot: snapshot,
      payment_method_preference: 'card',
      notes: notes || null,
      party_tags: partyTags,
    }).select('id').single()

    if (dbErr || !booking) {
      console.error('Admin party create error:', dbErr)
      return NextResponse.json({ error: dbErr?.message || 'Failed to create booking' }, { status: 500 })
    }

    await writeLineItems(supabase, booking.id, lineItems)

    // Log creation
    await supabase.from('booking_modifications').insert({
      booking_id: booking.id,
      modified_by: 'admin',
      change_summary: 'Party Plan created by admin',
      new_data: { contactName, contactEmail, partyDate, partyTime, guestCount: guests, packageType, lockDate },
    })

    // Upsert contact
    await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: 'Party Plan — Admin Created',
      serviceInterests: ['kids_party'],
    })

    // Generate portal token
    const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret) // default 30-day expiry
    await supabase.from('portal_tokens').insert({
      booking_id: booking.id,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    }).then(({ error }) => {
      if (error) console.error('Portal token insert (non-fatal):', error)
    })

    const builderUrl = buildPortalUrl(bookingRef, rawToken, '/party-planner')

    // Send email
    if (sendEmail && process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

      const emailLineItems = lineItems.map(item => ({
        name: item.name,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        guest_multiplied: item.guest_multiplied,
        totalCents: item.guest_multiplied
          ? item.unit_price_cents * item.quantity * guests
          : item.unit_price_cents * item.quantity,
      }))

      await resend.emails.send({
        from,
        to: contactEmail,
        subject: `Your Host Hampton Party Plan — ${bookingRef}`,
        html: partyQuoteSentHtml({
          customerName: contactName,
          bookingRef,
          partyDate: partyDate ? formatDate(partyDate) : undefined,
          partyTime: partyTime ? formatTime(partyTime) : undefined,
          guestCount: guests,
          packageType: packageType || 'Kids Party',
          childName,
          totalFormatted: formatMoney(totalCents),
          depositFormatted: formatMoney(depositCents),
          balanceFormatted: formatMoney(balanceDueCents),
          lineItems: emailLineItems,
          builderUrl,
          notes,
        }),
      }).catch(err => console.error('Quote email error (non-fatal):', err))
    }

    return NextResponse.json({
      ok: true,
      bookingRef,
      bookingId: booking.id,
      builderUrl,
      adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Create failed'
    console.error('Admin party create error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
