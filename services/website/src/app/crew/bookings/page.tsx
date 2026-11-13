import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadBookingViewer } from '@/lib/crew/bookingView'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import BookingsView from '../_components/BookingsView'

export const dynamic = 'force-dynamic'

/**
 * `/crew/bookings`: the booked parties and what each one needs, read only (migration 100). The admin
 * Bookings screen without the money, the contact details or any link out. 404 for anyone who has not
 * been given the view.
 */
export default async function CrewBookingsPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  const v = await loadBookingViewer(getSupabase(), member.id)
  if (v.kind !== 'ok') return <CrewUnavailable />
  if (!v.data) notFound()
  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>Bookings</h1>
      <BookingsView />
    </main>
  )
}
