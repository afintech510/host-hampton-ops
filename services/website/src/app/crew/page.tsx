import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadCrewSettings } from '@/lib/crew/settings'
import { loadBoard, loadViewerContext } from '@/lib/crew/board'
import { meView } from '@/lib/crew/view'
import CrewTop, { CrewUnavailable } from './_components/CrewTop'
import PartyCard, { visibleSpots } from './_components/PartyCard'

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
  const open = upcoming.filter(b => !b.view.mySlot && visibleSpots(b, me.canLead).length > 0)
  const full = upcoming.filter(b => !b.view.mySlot && visibleSpots(b, me.canLead).length === 0)

  return (
    <main className="crew-wrap">
      <CrewTop firstName={me.firstName} isTest={member.is_test} />
      <h1>Hi {me.firstName}!</h1>
      {me.rateLine ? (
        <div className="crew-rate">
          <p className="crew-rate-big">{me.rateLine}</p>
          <p className="crew-small" style={{ opacity: 0.8, marginTop: '.35rem' }}>
            <Link href="/crew/pay" style={{ fontWeight: 700 }}>How your pay works</Link>
          </p>
        </div>
      ) : (
        <p className="crew-muted crew-small" style={{ marginTop: 0 }}>
          Tell us which parties you&apos;re available to work, and set the times you can&apos;t work in <Link className="crew-link" href="/crew/availability">Availability</Link>.
        </p>
      )}

      <section aria-labelledby="crew-mine">
        <h2 id="crew-mine">My parties</h2>
        {mine.length === 0
          ? <p className="crew-muted">You&apos;re not on anything yet. Tell us below which parties you&apos;re available to work.</p>
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
          <h2 id="crew-full">Full</h2>
          <p className="crew-muted crew-small" style={{ marginTop: 0 }}>
            These have the crew they need right now. If someone can&apos;t make it, the people on standby are asked first.
          </p>
          {full.map(b => <PartyCard key={b.view.id} b={b} canLead={me.canLead} />)}
        </section>
      )}

    </main>
  )
}
