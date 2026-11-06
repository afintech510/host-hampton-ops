import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { isUuid } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { getPartyWithSlots } from '@/lib/crew/db'
import { classifyDrop, formatCents, isInGracePeriod, partyRateCents, standbyEscalateAt } from '@/lib/crew/rules'
import { askedCount, myCoverOnParty } from '@/lib/crew/cover'
import { clockLabel, partyDayLabel, partyTimeLabel } from '@/lib/crew/view'
import { STUDIO_PHONE_DISPLAY } from '@/lib/studioLocation'
import CrewTop, { CrewUnavailable } from '../../../_components/CrewTop'
import ActionButton from '../../../_components/ActionButton'

export const dynamic = 'force-dynamic'

/**
 * `/crew/parties/[id]/cant-make-it` (spec §8): where a cover request STANDS.
 * How many crew were asked (a count, never names), when Allie steps in,
 * Withdraw, and Drop anyway behind a confirmation. A request is started from
 * Find Cover on the party, not here; with none open this goes back to the party.
 */
export default async function CantMakeItPage({ params }: { params: { id: string } }) {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  if (!isUuid(params.id)) notFound()

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const s = settings.settings
  const pws = await getPartyWithSlots(sb, params.id)
  if (pws.kind !== 'ok') return <CrewUnavailable />
  if (!pws.data || pws.data.party.status === 'draft') notFound()
  const { party, slots } = pws.data
  const mine = slots.find(sl => sl.member_id === member.id && sl.status === 'assigned') ?? null
  const cover = await myCoverOnParty(sb, member.id, slots.map(sl => sl.id))
  if (cover.kind !== 'ok') return <CrewUnavailable />
  const last = cover.data
  if (!mine && !last) notFound()

  const now = new Date()
  const startsAt = new Date(party.starts_at)
  const when = `${partyDayLabel(party.starts_at)}, ${partyTimeLabel(party.starts_at, party.ends_at)}`
  const grace = isInGracePeriod(now, s)
  const startRate = s.ladderEnabled ? formatCents(partyRateCents('crew', 0, s)) : ''
  const header = (
    <>
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <p className="crew-small" style={{ margin: '0 0 .5rem' }}><Link className="crew-link" href={`/crew/parties/${party.id}`}>← {party.theme || party.title}</Link></p>
      <h1>Finding cover</h1>
      <p className="crew-muted" style={{ marginTop: 0 }}>{party.theme || party.title} · {when}</p>
    </>
  )

  // ── A live request: the status view.
  const live = last && (last.status === 'open' || last.status === 'escalated') && mine && last.slot_id === mine.id ? last : null
  if (live) {
    const asked = await askedCount(sb, live.id)
    if (asked.kind !== 'ok') return <CrewUnavailable />
    const escalateAt = standbyEscalateAt(new Date(live.created_at), asked.data, s)
    const dropConfirm = !s.ladderEnabled
      ? 'If you drop it now, nobody is covering it and the manager will have to find someone. Only drop it if you truly can\'t be there. Drop the party?'
      : grace
        ? "If you drop it now, nobody is covering it. While we're getting started your rate won't change, but the manager will see it. Drop the party?"
        : `If you drop it with nobody covering, you'll go back to ${startRate} a party. Drop the party?`
    return (
      <main className="crew-wrap">
        {header}
        <div className="crew-card">
          <h3>We&apos;re looking for cover</h3>
          <p>
            {asked.data === 0
              ? 'Nobody had said they could cover this one, so we are asking everyone who is free that day.'
              : `We asked ${asked.data} crew ${asked.data === 1 ? 'member' : 'members'} who said they can cover.`}
          </p>
          {live.status === 'open' && asked.data > 0 && now < escalateAt && (
            <p>If nobody takes it by {clockLabel(escalateAt)}, we ask everyone who is free that day.</p>
          )}
          {(live.status === 'escalated' || now >= escalateAt) && <p>We are finding someone.</p>}
          {live.offered_to_all_at && <p>It has been offered to everyone free that day.</p>}
          <p className="crew-note crew-info" style={{ marginBottom: 0 }}>
            You&apos;re still on the party until someone takes it.{s.ladderEnabled ? ' If someone covers you, nothing changes for you.' : ' If someone covers you, you\'re off the hook.'}
          </p>
        </div>
        <div className="crew-row" style={{ flexWrap: 'wrap', gap: '.75rem' }}>
          <ActionButton endpoint={`/api/crew/swaps/${live.id}/withdraw`} label="I can make it after all" busyLabel="Keeping your spot…" />
          <ActionButton endpoint={`/api/crew/swaps/${live.id}/drop`} label="Drop anyway" variant="ghost" confirmText={dropConfirm} />
        </div>
      </main>
    )
  }

  // ── Off the party: covered, or dropped.
  if (!mine) {
    return (
      <main className="crew-wrap">
        {header}
        {last?.status === 'claimed'
          ? <p className="crew-note crew-success">You&apos;re covered. Someone took your spot{s.ladderEnabled ? ", and your rate doesn't change" : ''}. Thanks for asking early!</p>
          : last?.status === 'dropped_uncovered'
            ? <p className="crew-note crew-warn">You&apos;re off this party. Allie knows the spot is open.</p>
            : <p className="crew-note crew-info">You&apos;re not on this party.</p>}
        <p><Link className="crew-link" href="/crew">Back to parties</Link></p>
      </main>
    )
  }

  // ── On the party, nothing asked yet: what it would cost.
  const drop = classifyDrop(startsAt, now, s)
  if (drop.kind === 'started') {
    return (
      <main className="crew-wrap">
        {header}
        <p className="crew-note crew-warn">The party already started. Call Allie at {STUDIO_PHONE_DISPLAY}.</p>
      </main>
    )
  }

  // Nothing asked yet: Find Cover, on the party, is where a cover request starts.
  redirect(`/crew/parties/${party.id}`)
}
