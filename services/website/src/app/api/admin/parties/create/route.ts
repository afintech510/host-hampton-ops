import { NextRequest, NextResponse } from 'next/server'
import { portalSigningSecret } from '@/lib/portalAuth'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { logBookingChange } from '@/lib/bookingAudit'
import { upsertContact } from '@/lib/contacts'
import { computeCutoffDates, generatePartyRef, formatMoney } from '@/lib/partyPricing'
import { buildPlanSnapshot, planTotals, writeLineItems } from '@/lib/plan'
import { mintPortalLink } from '@/lib/portalLinkMint'
import { partyQuoteSentHtml } from '@/lib/emailTemplates'
import type { BookingLineItem } from '@/types/booking-flow'
import { publicOrigin } from '@/lib/publicOrigin'
import { isPartyType, PARTY_TYPES } from '@/lib/pipelineStages'

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
      partyType, eventType, source, invoiceNumber, locationAddress,
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
      /**
       * The five below exist for the invoice importer (2026-09-14). This route
       * used to hard-code `kid-party` / `in_studio_theme` / `admin`, which is
       * right for the phone booking it was written for and wrong for every
       * mobile party and studio rental quoted outside the system — and those are
       * exactly the rows being brought in. `party_type` is the field the whole
       * Parties tab filters and counts on, and `event_type` is NOT patchable
       * afterwards, so both have to be settable here or the imported rows land
       * permanently mislabelled.
       */
      partyType?: string
      eventType?: string
      source?: string
      invoiceNumber?: string
      locationAddress?: string
    }

    if (!contactName || !contactEmail) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    // Refused, not silently dropped: a CHECK-constrained column given a bad
    // value should fail loudly here rather than land NULL and read as
    // "Unclassified" forever — the defect migration 035's comment describes.
    if (partyType !== undefined && !isPartyType(partyType)) {
      return NextResponse.json(
        { error: `party_type must be one of: ${PARTY_TYPES.join(', ')}` },
        { status: 400 },
      )
    }

    const supabase = getSupabase()
    const origin = publicOrigin(req)
    const portalSecret = portalSigningSecret()
    const guests = guestCount || 10
    const cutoffs = partyDate ? computeCutoffDates(partyDate) : null
    const bookingRef = generatePartyRef()

    const partyTags: Record<string, unknown> = {
      date_locked: !!lockDate,
      created_by: adminActorId(req),
      created_at: new Date().toISOString(),
      ...(locationAddress ? { location_address: locationAddress } : {}),
      ...(partyType === 'mobile_party' ? { location_type: 'mobile' } : {}),
    }

    const snapshot = buildPlanSnapshot({ lineItems, guestCount: guests, packageType })
    const { total_cents: totalCents, deposit_amount: depositCents, balance_due_cents: balanceDueCents } =
      planTotals(snapshot)

    const { data: booking, error: dbErr } = await supabase.from('bookings').insert({
      booking_ref: bookingRef,
      status: 'awaiting_deposit',
      event_type: eventType || 'kid-party',
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
      party_type: partyType || 'in_studio_theme',
      source: source || 'admin',
      invoice_number: invoiceNumber || null,
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
    await logBookingChange(supabase, {
      bookingId: booking.id, actor: adminActorId(req),
      summary: 'Party Plan created by admin',
    })

    // Upsert contact
    await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: 'Party Plan — Admin Created',
      serviceInterests: ['kids_party'],
    })

    // Generate the portal token. This DID read its error — and then called it
    // "non-fatal" and mailed the link anyway, which is precisely the failure:
    // a token row that was refused means the URL in that email cannot work, so
    // the customer clicks through to a locked door. Non-fatal to the booking,
    // certainly; fatal to the email.
    const minted = await mintPortalLink(supabase, booking.id as string, bookingRef, '/party-planner')
    const builderUrl = minted.ok ? minted.url : null

    // Send email
    // No link, no email — see mintPortalLink.
    if (sendEmail && builderUrl && process.env.RESEND_API_KEY) {
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
