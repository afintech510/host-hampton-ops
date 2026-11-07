import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { isUuid } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { getPartyWithSlots } from '@/lib/crew/db'
import { boardParty, loadViewerContext, teamNames } from '@/lib/crew/board'
import { formatCents } from '@/lib/crew/rules'
import { loadCrewPartyDetails, type CrewPartyDetails } from '@/lib/crew/partyDetails'
import { clockLabel, partyDayLabel, partyTimeLabel } from '@/lib/crew/view'
import CrewTop, { CrewUnavailable } from '../../_components/CrewTop'
import PartyCard from '../../_components/PartyCard'

export const dynamic = 'force-dynamic'

/**
 * `/crew/parties/[id]` (spec §8). The team shows first names and whether each
 * has confirmed, nothing else. A party the member is not on and could not take
 * a spot or stand by on right now (a draft, or one that has started or ended)
 * is a 404, the same answer as a party that does not exist.
 */
export default async function CrewPartyPage({ params }: { params: { id: string } }) {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  if (!isUuid(params.id)) notFound()

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const pws = await getPartyWithSlots(sb, params.id)
  if (pws.kind !== 'ok') return <CrewUnavailable />
  if (!pws.data) notFound()
  const now = new Date()
  const [ctx, names] = await Promise.all([loadViewerContext(sb, member, settings.settings, now), teamNames(sb, [pws.data])])
  if (ctx.kind !== 'ok' || names.kind !== 'ok') return <CrewUnavailable />

  const b = boardParty(pws.data, names.data, ctx.data)
  if (!b || (!b.view.mySlot && !b.upcoming)) notFound()
  const v = b.view
  // The child's and family's details go ONLY to a member who is on the party (like the address).
  let details: CrewPartyDetails | null = null
  const bookingId = pws.data.party.booking_id
  if (v.mySlot && bookingId) {
    const d = await loadCrewPartyDetails(sb, bookingId)
    if (d.kind !== 'ok') return <CrewUnavailable />
    details = d.data
  }
  // The lead-in and wrap-up in words, from THIS person's actual shift (a Lead arrives earlier than a helper).
  const before = Math.round((new Date(v.startsAt).getTime() - new Date(v.shiftStartsAt).getTime()) / 60_000)
  const after = Math.round((new Date(v.shiftEndsAt).getTime() - new Date(v.endsAt).getTime()) / 60_000)

  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <p className="crew-small" style={{ margin: '0 0 .5rem' }}><Link className="crew-link" href="/crew">← Parties</Link></p>
      <h1>{v.theme || v.title}</h1>
      {v.theme && v.theme !== v.title && <p className="crew-muted" style={{ marginTop: 0 }}>{v.title}</p>}

      <div className="crew-card">
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.35rem .9rem' }}>
          <dt className="crew-muted">Party time</dt><dd style={{ margin: 0 }}>{partyDayLabel(v.startsAt)}, {partyTimeLabel(v.startsAt, v.endsAt)}</dd>
          <dt className="crew-muted">Your shift</dt>
          <dd style={{ margin: 0 }}>
            {clockLabel(v.shiftStartsAt)} – {clockLabel(v.shiftEndsAt)}
            <span className="crew-muted crew-small" style={{ display: 'block' }}>{v.work ? 'The shift is the whole time.' : `${before} min to set up before the party, ${after} min to clean up after`}</span>
          </dd>
          <dt className="crew-muted">Where</dt><dd style={{ margin: 0 }}>{v.location}</dd>
          {!v.work && (<><dt className="crew-muted">Kids</dt><dd style={{ margin: 0 }}>{v.guestCount != null ? v.guestCount : 'Not confirmed yet'}</dd></>)}
          <dt className="crew-muted">Crew</dt><dd style={{ margin: 0 }}>{v.staffed} of {v.needed} spots taken</dd>
          {v.mySlot && (<>
            <dt className="crew-muted">Your spot</dt>
            <dd style={{ margin: 0 }}>{v.mySlot.role === 'lead' ? 'Party Lead' : 'Crew'}{v.mySlot.payCents != null && <>, <strong>{formatCents(v.mySlot.payCents)}</strong></>}</dd>
          </>)}
        </dl>
      </div>

      {b.calUrl && v.mySlot && b.upcoming && (
        <div className="crew-card">
          <h3>Add to your calendar</h3>
          <p className="crew-muted crew-small" style={{ marginTop: 0 }}>
            Puts your whole shift, {clockLabel(v.shiftStartsAt)} – {clockLabel(v.shiftEndsAt)}, and the address on your phone, with reminders.
          </p>
          <div className="crew-row">
            <a className="crew-btn crew-btn-ghost" href={`${b.calUrl}?format=google`} target="_blank" rel="noopener noreferrer">Google Calendar</a>
            <a className="crew-btn crew-btn-ghost" href={`${b.calUrl}?format=ics`}>Apple Calendar</a>
          </div>
        </div>
      )}

      {details && (details.child || details.parent || details.theme || details.food.length > 0 || details.activities.length > 0) && (
        <div className="crew-card">
          <h3>About this party</h3>
          <dl style={{ margin: '.5rem 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.35rem .9rem' }}>
            {details.child && (<><dt className="crew-muted">Celebrating</dt><dd style={{ margin: 0 }}>{details.child}</dd></>)}
            {details.parent && (<><dt className="crew-muted">Parent</dt><dd style={{ margin: 0 }}>{details.parent}</dd></>)}
            {details.theme && (<><dt className="crew-muted">Theme</dt><dd style={{ margin: 0 }}>{details.theme}</dd></>)}
            {details.food.length > 0 && (<><dt className="crew-muted">Food</dt><dd style={{ margin: 0 }}>{details.food.join(' · ')}</dd></>)}
            {details.activities.length > 0 && (<><dt className="crew-muted">Activities</dt><dd style={{ margin: 0 }}>{details.activities.join(' · ')}</dd></>)}
          </dl>
        </div>
      )}

      {v.notesForCrew && (
        <div className="crew-card">
          <h3>Notes from Allie</h3>
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{v.notesForCrew}</p>
        </div>
      )}

      <h2>The team</h2>
      {v.team.length === 0
        ? <p className="crew-muted">Nobody yet.</p>
        : (
          <ul className="crew-team">
            {v.team.map((t, i) => (
              <li key={i}>
                {t.isMe ? 'You' : t.firstName}{t.role === 'lead' ? ' (Lead)' : ''} {t.confirmed ? '✓' : <span className="crew-muted">· not confirmed yet</span>}
              </li>
            ))}
          </ul>
        )}

      <h2>{v.mySlot ? 'Your spot' : 'Spots'}</h2>
      <PartyCard b={b} canLead={member.can_lead} linkToDetail={false} />

      {v.mySlot && b.upcoming && (
        <p className="crew-note crew-info">
          Can&apos;t make it? Tap <strong>Find Cover</strong> above. You stay on the party until someone takes your spot.
        </p>
      )}
    </main>
  )
}
