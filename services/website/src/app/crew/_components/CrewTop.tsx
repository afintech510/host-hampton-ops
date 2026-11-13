import CrewBrand from './CrewBrand'
import CrewNav from './CrewNav'
import { getSupabase } from '@/lib/supabase'
import { crewPayLadderEnabled, crewShowPayEnabled } from '@/lib/crew/settings'
import { crewCookieMemberId } from '@/lib/crew/auth'
import { loadBookingViewer } from '@/lib/crew/bookingView'

/**
 * Header (brand, and who is signed in) and the bottom nav, around a signed-in page. Sign out lives on the Profile page.
 * A member with the Bookings view (migration 100) also gets the Bookings and Schedule tabs; an unreadable grant shows no
 * extra tabs (the pages and APIs behind them check again).
 */
export default async function CrewTop({ firstName, isTest }: { firstName: string; isTest: boolean }) {
  const id = crewCookieMemberId()
  const viewer = id ? await loadBookingViewer(getSupabase(), id) : null
  return (
    <>
      <div className="crew-top">
        <CrewBrand />
        <span className="crew-who crew-small">
          {isTest && <span className="crew-chip crew-gold">Test</span>}
          <span className="crew-muted crew-who-name">{firstName}</span>
        </span>
      </div>
      <CrewNav showPay={crewShowPayEnabled() || crewPayLadderEnabled()} showBookings={viewer?.kind === 'ok' && viewer.data} />
    </>
  )
}

export function CrewUnavailable() {
  return (
    <div className="crew-wrap">
      <p className="crew-note crew-warn">We couldn&apos;t load this just now. Pull down to refresh, or try again in a minute.</p>
    </div>
  )
}
