import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { calculateCardFee, calculateLineItemTotal, computeCutoffDates, formatMoney, getDepositCents } from '@/lib/partyPricing'
import { studioRentalRateWith, hoursBetween, STUDIO_STANDING_CAPACITY } from '@/lib/studioRental'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { createEmbeddedAgreement, isSignwellConfigured } from '@/lib/signwell'
import type { BookingLineItem } from '@/types/booking-flow'

/** Add-on line item as it arrives from the builder (price_type is cosmetic in the DB). */
interface IncomingLineItem {
  pricing_item_id?: string | null
  name: string
  category: string
  quantity: number
  unit_price_cents: number
  price_type: string
  guest_multiplied: boolean
}

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateStudioRef(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)]
  return `HH-STU-${code}`
}

function to12hr(time24: string): string {
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/** date - N days → 'YYYY-MM-DD' */
function minusDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const contactName = (body.contactName as string || '').trim()
    const contactEmail = (body.contactEmail as string || '').trim()
    const contactPhone = (body.contactPhone as string || '').trim()
    const contactAddress = (body.contactAddress as string || '').trim()
    const eventType = (body.eventType as string || '').trim()
    const partyDate = body.partyDate as string
    const startTime = body.startTime as string // 'HH:mm'
    const endTime = body.endTime as string     // 'HH:mm'
    const guestCount = Number(body.guestCount)
    const seatingNeeded = body.seatingNeeded != null ? Number(body.seatingNeeded) : null
    const notes = (body.notes as string | undefined)?.trim() || null
    const addOns = (body.lineItems as IncomingLineItem[]) || []
    const marketingConsent = !!body.marketingConsent

    if (!contactName || !contactEmail || !partyDate || !startTime || !endTime || !guestCount || !eventType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (guestCount > STUDIO_STANDING_CAPACITY) {
      return NextResponse.json({ error: `Our studio holds up to ${STUDIO_STANDING_CAPACITY} guests. Please call us for larger events.` }, { status: 400 })
    }

    const hours = hoursBetween(startTime, endTime)
    // Rates from `pricing_items` (migration 036), not a compiled constant — this
    // is the figure the customer is actually charged, so it must be the live one.
    const { studioRates } = await loadPricingCatalog()
    const rate = studioRentalRateWith(studioRates, partyDate, hours)

    // Full line-item set: rental fee first, then the customer's add-ons.
    const rentalLineItem: IncomingLineItem = {
      pricing_item_id: null,
      name: rate.lineItemLabel,
      category: 'rental',
      quantity: 1,
      unit_price_cents: rate.rentalCents,
      price_type: 'flat',
      guest_multiplied: false,
    }
    const allLineItems = [rentalLineItem, ...addOns]

    // price_type is cosmetic to the math (only guest_multiplied/quantity matter), so the cast is safe.
    const totalCents = calculateLineItemTotal(allLineItems as unknown as BookingLineItem[], guestCount)
    const depositCents = getDepositCents(totalCents)
    const balanceDueCents = Math.max(0, totalCents - depositCents)
    const addOnTotalCents = totalCents - rate.rentalCents
    const balanceDueDate = minusDays(partyDate, 7)
    const { modificationCutoff, guestCountCutoff } = computeCutoffDates(partyDate)

    const supabase = getSupabase()
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3002'
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    const proto = req.headers.get('x-forwarded-proto') || (isLocal ? 'http' : 'https')
    const origin = `${proto}://${host}`

    const bookingRef = generateStudioRef()

    const partyTags: Record<string, unknown> = {
      rental_start_time: startTime,
      rental_end_time: endTime,
      rental_hours: rate.hours,
      is_weekend: rate.isWeekend,
      event_label: eventType,
      address: contactAddress || null,
      seating_needed: seatingNeeded,
      balance_due_date: balanceDueDate,
      security_deposit_cents: studioRates.securityDepositCents,
    }

    const quoteSnapshot = {
      lineItems: allLineItems,
      guestCount,
      totalCents,
      depositCents,
      balanceDueCents,
      rate,
      eventType,
      startTime,
      endTime,
      contactAddress,
    }

    // Insert booking (awaiting deposit until the PaymentIntent succeeds)
    const { data: booking, error: dbError } = await supabase.from('bookings').insert({
      booking_ref: bookingRef,
      status: 'awaiting_deposit',
      event_type: 'studio-rental',
      party_date: partyDate,
      party_time: startTime,
      package_type: rate.lineItemLabel,
      guest_count_approx: guestCount,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      deposit_amount: depositCents,
      total_cents: totalCents,
      balance_due_cents: balanceDueCents,
      card_fee_rate: 0.03,
      modification_cutoff: modificationCutoff,
      guest_count_cutoff: guestCountCutoff,
      quote_snapshot: quoteSnapshot,
      payment_method_preference: 'card',
      security_deposit_status: 'none',
      notes,
      party_tags: partyTags,
    }).select('id').single()

    if (dbError || !booking) {
      console.error('Studio rental booking insert error:', dbError)
      return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
    }

    // Insert line items
    const lineItemRows = allLineItems.map((item, idx) => ({
      booking_id: booking.id,
      pricing_item_id: item.pricing_item_id || null,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      price_type: item.price_type,
      guest_multiplied: item.guest_multiplied,
      sort_order: idx,
    }))
    const { error: liError } = await supabase.from('booking_line_items').insert(lineItemRows)
    if (liError) console.error('Studio line items insert error (non-fatal):', liError)

    // Contact + sequence (non-fatal)
    const contactId = await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: `Studio rental — ${eventType}`,
      serviceInterests: ['room_rental'],
      marketingConsent,
    }).catch(() => null)
    if (contactId) {
      await enrollInSequence({
        contactId,
        contactEmail,
        triggerEvent: 'booking_confirmed',
        serviceType: 'room_rental',
        eventDate: partyDate,
        bookingRef,
      }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
    }

    // SignWell agreement (graceful if unconfigured — dev/preview)
    let signingUrl: string | null = null
    if (isSignwellConfigured()) {
      try {
        const { documentId, embeddedSigningUrl } = await createEmbeddedAgreement({
          bookingRef,
          signerName: contactName,
          signerEmail: contactEmail,
          fields: {
            client_name: contactName,
            phone: contactPhone,
            email: contactEmail,
            event_type: eventType,
            // SignWell date field requires a full ISO-8601 datetime (date-only is
            // rejected). partyDate is YYYY-MM-DD; append midnight UTC. SignWell
            // renders it in the field's configured format on the signed PDF.
            event_date: `${partyDate}T00:00:00Z`,
            start_time: to12hr(startTime),
            end_time: to12hr(endTime),
            headcount: guestCount,
            rental_fee: formatMoney(rate.rentalCents),
            addons: formatMoney(addOnTotalCents),
            security_deposit: formatMoney(studioRates.securityDepositCents),
            deposit_due: formatMoney(depositCents),
            balance_due: formatMoney(balanceDueCents),
            total_due: formatMoney(totalCents),
          },
        })
        signingUrl = embeddedSigningUrl
        await supabase.from('bookings').update({ signwell_document_id: documentId }).eq('id', booking.id)
      } catch (err) {
        console.error('SignWell create error (non-fatal — proceeding without signature):', err)
      }
    }

    // Stripe deposit PaymentIntent (deposit + 3% card fee), in-page Payment Element
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    const cardFeeCents = calculateCardFee(depositCents)
    const totalChargeCents = depositCents + cardFeeCents

    const intent = await stripe.paymentIntents.create({
      amount: totalChargeCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      receipt_email: contactEmail,
      description: `Host Hampton Studio Rental — Deposit (${bookingRef})`,
      statement_descriptor_suffix: 'STUDIO DEP',
      metadata: {
        type: 'studio_rental',
        payment_type: 'deposit',
        booking_ref: bookingRef,
        booking_id: booking.id,
        depositCents: String(depositCents),
        cardFeeCents: String(cardFeeCents),
        contactName,
        contactEmail,
        contactPhone: contactPhone || '',
        partyDate,
        startTime,
        endTime,
        guestCount: String(guestCount),
      },
    })

    void origin
    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      bookingRef,
      bookingId: booking.id,
      signingUrl,
      depositCents,
      cardFeeCents,
      totalCents,
      balanceDueCents,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Studio rental checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
