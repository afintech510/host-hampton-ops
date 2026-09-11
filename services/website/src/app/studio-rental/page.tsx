import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import StudioRentalContent from './StudioRentalContent'
import StudioManageContent, { type ManageBooking } from './StudioManageContent'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import { loadPricingCatalog } from '@/lib/pricingCatalog'

export const metadata: Metadata = {
  title: 'Rent the Studio — Host Hampton | Speonk, NY',
  description:
    'Reserve our private Hamptons studio for your baby shower, first birthday, or holiday party. Seats up to 65 (85 standing). Pick your date, build your add-ons, sign, and reserve with a $250 deposit — all online.',
  openGraph: {
    title: 'Rent the Studio — Host Hampton',
    description: 'Pick your date, build your add-ons, sign, and reserve in one place.',
  },
}

export const dynamic = 'force-dynamic'

export default async function StudioRentalPage() {
  const supabase = getSupabase()

  // The rate card is data now (migration 036); both modes price from it.
  const { studioRates } = await loadPricingCatalog(supabase)

  // Load the studio add-on menu (used by both new-booking and manage modes).
  let items: PricingItem[] = []
  try {
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, price_type, is_popular, sort_order, emoji')
      .eq('is_active', true)
      .contains('event_types', ['studio-rental'])
      .order('sort_order', { ascending: true })
    items = data ?? []
  } catch {
    // page still renders without the menu
  }
  const byCategory = (cat: string) => items.filter(i => i.category === cat)
  const menu = {
    decor: byCategory('decor-add-on'),
    services: byCategory('service-add-on'),
    food: byCategory('food-add-on'),
    desserts: byCategory('dessert-add-on'),
    beverages: byCategory('beverage-add-on'),
  }

  // Manage mode: if a valid portal cookie points at a studio booking, load it.
  let manageBooking: ManageBooking | null = null
  try {
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const cookieHeader = cookies().toString()
    const ref = getPortalBookingRef(cookieHeader, secret)
    if (ref) {
      const { data: bk } = await supabase
        .from('bookings')
        .select('id, booking_ref, event_type, party_date, party_time, guest_count_approx, contact_name, contact_email, contact_phone, status, total_cents, balance_due_cents, party_tags')
        .eq('booking_ref', ref)
        .eq('event_type', 'studio-rental')
        .single()
      if (bk) {
        const [{ data: li }, { data: pays }] = await Promise.all([
          supabase.from('booking_line_items').select('pricing_item_id, name, category, quantity, unit_price_cents, price_type, guest_multiplied').eq('booking_id', bk.id).order('sort_order'),
          supabase.from('booking_payments').select('payment_type, payment_method, amount_cents, paid_at').eq('booking_id', bk.id).order('paid_at', { ascending: false }),
        ])
        const tags = (bk.party_tags as Record<string, unknown>) || {}
        manageBooking = {
          bookingRef: bk.booking_ref,
          partyDate: bk.party_date,
          startTime: (tags.rental_start_time as string) || bk.party_time || '14:00',
          endTime: (tags.rental_end_time as string) || '17:00',
          guestCount: bk.guest_count_approx || 1,
          seatingNeeded: (tags.seating_needed as number) ?? null,
          eventType: (tags.event_label as string) || '',
          contactName: bk.contact_name || '',
          contactEmail: bk.contact_email || '',
          contactPhone: bk.contact_phone || '',
          status: bk.status,
          totalCents: bk.total_cents || 0,
          balanceDueCents: bk.balance_due_cents || 0,
          lineItems: (li || []).map(x => ({ ...x })),
          payments: (pays || []).map(x => ({ ...x })),
        }
      }
    }
  } catch {
    // fall through to new-booking page
  }

  if (manageBooking) {
    return <StudioManageContent booking={manageBooking} menu={menu} rates={studioRates} />
  }

  return (
    <StudioRentalContent
      decor={menu.decor}
      services={menu.services}
      food={menu.food}
      desserts={menu.desserts}
      beverages={menu.beverages}
      rates={studioRates}
    />
  )
}
