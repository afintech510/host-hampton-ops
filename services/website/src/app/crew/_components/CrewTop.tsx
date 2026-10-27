import ActionButton from './ActionButton'
import CrewNav from './CrewNav'

/** Header (brand + sign out) and the bottom nav, around a signed-in page. */
export default function CrewTop({ firstName, isTest }: { firstName: string; isTest: boolean }) {
  return (
    <>
      <div className="crew-top">
        <span className="crew-brand">Host Hampton Crew</span>
        <span className="crew-row crew-small">
          {isTest && <span className="crew-chip crew-gold">Test</span>}
          <span className="crew-muted">{firstName}</span>
          <ActionButton endpoint="/api/crew/auth/logout" label="Sign out" variant="ghost" redirectTo="/crew/login" />
        </span>
      </div>
      <CrewNav />
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
