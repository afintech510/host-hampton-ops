import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { isUuid } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { firstNamesFor, memberStandbyPartyIds } from '@/lib/crew/db'
import { formatCents, partyPayCents } from '@/lib/crew/rules'
import { loadCover } from '@/lib/crew/cover'
import { partyDayLabel, partyTimeLabel, partyView } from '@/lib/crew/view'
import CrewTop, { CrewUnavailable } from '../../_components/CrewTop'
import ActionButton from '../../_components/ActionButton'

export const dynamic = 'force-dynamic'

/**
 * `/crew/cover/[id]`: the link in a cover text. Shows the spot and what it pays
 * THIS member, and one button. The person cancelling is a first name; their
 * reason is never here. Anything that has moved on says "Someone just took it."
 */
export default async function CoverPage({ params }: { params: { id: string } }) {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  if (!isUuid(params.id)) notFound()

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const s = settings.settings
  const cover = await loadCover(sb, params.id)
  if (cover.kind !== 'ok') return <CrewUnavailable />
  if (!cover.data) notFound()
  const { swap, pws } = cover.data
  const party = pws.party
  if (party.status === 'draft') notFound()
  if (swap.requester_id === member.id) redirect(`/crew/parties/${party.id}/cant-make-it`)
  // Invented test members are never offered a real party (the same rule as eligibleFor).
  if (member.is_test && party.booking_id) notFound()

  const header = <CrewTop firstName={member.first_name} isTest={member.is_test} />
  const now = new Date()
  const liveStatus = swap.status === 'open' || swap.status === 'escalated'

  if (swap.status === 'claimed' && swap.claimed_by === member.id) {
    return (
      <main className="crew-wrap">
        {header}
        <p className="crew-note crew-success">You&apos;re on it. Thanks for covering!</p>
        <p><Link className="crew-link" href={`/crew/parties/${party.id}`}>See the party</Link></p>
      </main>
    )
  }
  if (!liveStatus || new Date(party.starts_at).getTime() <= now.getTime() || party.status !== 'published') {
    return (
      <main className="crew-wrap">
        {header}
        <p className="crew-note crew-info">Someone just took it. Thanks for being ready to help!</p>
        <p><Link className="crew-link" href="/crew">Back to parties</Link></p>
      </main>
    )
  }

  const [names, standby] = await Promise.all([firstNamesFor(sb, [swap.requester_id]), memberStandbyPartyIds(sb, member.id)])
  if (names.kind !== 'ok' || standby.kind !== 'ok') return <CrewUnavailable />
  const view = partyView({ party, slots: pws.slots, viewer: member, firstNames: new Map(), standbyMemberIds: new Set() }, s)
  if (!view) notFound()
  const who = names.data.get(swap.requester_id) ?? 'A crew member'
  const pay = formatCents(partyPayCents(swap.slot_role, member.steps, party.extra_flat_cents, s))
  const mayAsk = standby.data.has(party.id) || !!swap.offered_to_all_at
  const leadBlocked = swap.slot_role === 'lead' && !member.can_lead

  return (
    <main className="crew-wrap">
      {header}
      <h1>Cover needed</h1>
      <p className="crew-muted" style={{ marginTop: 0 }}>{who} can&apos;t make it.</p>
      <div className="crew-card">
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.35rem .9rem' }}>
          <dt className="crew-muted">Party</dt><dd style={{ margin: 0 }}>{party.theme || party.title}</dd>
          <dt className="crew-muted">When</dt><dd style={{ margin: 0 }}>{partyDayLabel(party.starts_at)}, {partyTimeLabel(party.starts_at, party.ends_at)}</dd>
          <dt className="crew-muted">Where</dt><dd style={{ margin: 0 }}>{view.location}</dd>
          <dt className="crew-muted">Spot</dt><dd style={{ margin: 0 }}>{swap.slot_role === 'lead' ? 'Party Lead' : 'Crew'}, <strong>{pay}</strong></dd>
        </dl>
      </div>
      {leadBlocked
        ? <p className="crew-note crew-info">That spot is for a Party Lead.</p>
        : !mayAsk
          ? <p className="crew-note crew-info">This one is for the crew who said they can cover it. If Allie opens it to everyone, you&apos;ll get a text.</p>
          : (
            <>
              <p>First to claim gets it. Once you&apos;ve worked it, covering a late cancel counts as two parties toward your rate.</p>
              <ActionButton endpoint={`/api/crew/swaps/${swap.id}/claim`} label={`Take it (${pay})`} busyLabel="Claiming…" redirectTo={`/crew/cover/${swap.id}`} />
            </>
          )}
    </main>
  )
}
