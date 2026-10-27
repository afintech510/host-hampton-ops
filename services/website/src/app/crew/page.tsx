import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadCrewSettings } from '@/lib/crew/settings'
import { loadBoard, loadViewerContext } from '@/lib/crew/board'
import { meView, partyDayLabel } from '@/lib/crew/view'
import CrewTop, { CrewUnavailable } from './_components/CrewTop'
import PartyCard, { visibleSpots } from './_components/PartyCard'
import ActionButton from './_components/ActionButton'

export const dynamic = 'force-dynamic'

/**
 * `/crew` (spec §8): my rate, parties waiting for my confirmation, my parties,
 * open parties (with MY pay for each spot), and the rest of the upcoming
 * parties, where I can say I'm a standby.
 */
export default async function CrewHomePage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const now = new Date()
  const ctx = await loadViewerContext(sb, member, settings.settings, now)
  if (ctx.kind !== 'ok') return <CrewUnavailable />
  const board = await loadBoard(sb, ctx.data)
  if (board.kind !== 'ok') return <CrewUnavailable />

  const me = meView(member, settings.settings)
  const upcoming = board.data.filter(b => b.upcoming)
  const mine = upcoming.filter(b => b.view.mySlot)
  const confirm = mine.filter(b => b.needsConfirm)
  const open = upcoming.filter(b => !b.view.mySlot && visibleSpots(b, me.canLead).length > 0)
  const full = upcoming.filter(b => !b.view.mySlot && visibleSpots(b, me.canLead).length === 0)

  return (
    <main className="crew-wrap">
      <CrewTop firstName={me.firstName} isTest={member.is_test} />
      <h1>Hi {me.firstName}!</h1>
      <div className="crew-rate">
        <p className="crew-rate-big">{me.rateLine}</p>
        <p className="crew-small" style={{ opacity: 0.8, marginTop: '.35rem' }}>
          <Link href="/crew/pay" style={{ color: '#F4B740', fontWeight: 700 }}>How your pay works</Link>
        </p>
      </div>

      {confirm.length > 0 && (
        <section aria-labelledby="crew-confirm">
          <h2 id="crew-confirm">Please confirm</h2>
          {confirm.map(b => (
            <div key={b.view.id} className="crew-card crew-row" style={{ justifyContent: 'space-between' }}>
              <span><strong>{b.view.theme || b.view.title}</strong> <span className="crew-muted">{partyDayLabel(b.view.startsAt)}</span></span>
              <ActionButton endpoint="/api/crew/confirm" body={{ slotId: b.view.mySlot!.slotId }} label="I'll be there" />
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="crew-mine">
        <h2 id="crew-mine">My parties</h2>
        {mine.length === 0
          ? <p className="crew-muted">You&apos;re not on any parties yet. Take a spot below.</p>
          : mine.map(b => <PartyCard key={b.view.id} b={b} canLead={me.canLead} />)}
      </section>

      <section aria-labelledby="crew-open">
        <h2 id="crew-open">Open parties</h2>
        {open.length === 0
          ? <p className="crew-muted">No open spots right now. New parties show up here as soon as they&apos;re posted.</p>
          : open.map(b => <PartyCard key={b.view.id} b={b} canLead={me.canLead} />)}
      </section>

      {full.length > 0 && (
        <section aria-labelledby="crew-full">
          <h2 id="crew-full">Full parties</h2>
          <p className="crew-muted crew-small" style={{ marginTop: 0 }}>
            Say you can cover, and if someone on the crew can&apos;t make it, you&apos;ll be among the first asked. No obligation.
          </p>
          {full.map(b => <PartyCard key={b.view.id} b={b} canLead={me.canLead} />)}
        </section>
      )}

      <p className="crew-small" style={{ marginTop: '1.5rem' }}>
        <Link className="crew-link" href="/crew/skills">My skills</Link>
      </p>
    </main>
  )
}
