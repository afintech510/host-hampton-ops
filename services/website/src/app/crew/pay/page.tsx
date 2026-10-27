import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadCrewSettings } from '@/lib/crew/settings'
import { getMemberSlots, partiesByIds } from '@/lib/crew/db'
import { formatCents } from '@/lib/crew/rules'
import { cancellingLines, meView, myPayRecords, partyDayLabel, payLadder } from '@/lib/crew/view'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'

export const dynamic = 'force-dynamic'

const METHOD: Record<string, string> = { venmo: 'Venmo', zelle: 'Zelle', cash: 'Cash', check: 'Check', other: 'Other' }

/**
 * `/crew/pay`: my rates, the ladder in dollars, how cancelling works (generated
 * from the settings), and my own worked parties. Dollars only: never a tier,
 * level or points.
 */
export default async function CrewPayPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const s = settings.settings
  const slots = await getMemberSlots(sb, member.id, { statuses: ['completed'] })
  if (slots.kind !== 'ok') return <CrewUnavailable />
  const parties = await partiesByIds(sb, slots.data.map(x => x.party_id))
  if (parties.kind !== 'ok') return <CrewUnavailable />
  const byId = new Map(parties.data.map(p => [p.id, p]))
  const records = myPayRecords(member.id, slots.data.flatMap(slot => {
    const party = byId.get(slot.party_id)
    return party ? [{ slot, party }] : []
  }))

  const me = meView(member, s)
  const ladder = payLadder(member.steps, me.canLead, s)
  const total = records.reduce((sum, r) => sum + (r.payCents ?? 0) + (r.extraCents ?? 0) + (r.tipCents ?? 0) + (r.tipTopupCents ?? 0), 0)

  return (
    <main className="crew-wrap">
      <CrewTop firstName={me.firstName} isTest={member.is_test} />
      <h1>My pay</h1>
      <div className="crew-rate">
        <p className="crew-rate-big">{me.rateLine}</p>
        <p className="crew-small" style={{ opacity: 0.85, marginTop: '.35rem' }}>
          Pay is per party, not per hour. Tips are on top.
        </p>
      </div>

      <h2>How your rate grows</h2>
      <div className="crew-card">
        <table className="crew-table">
          <thead>
            <tr><th scope="col">Crew</th>{me.canLead && <th scope="col">Leading</th>}<th scope="col"><span className="sr-only">You</span></th></tr>
          </thead>
          <tbody>
            {ladder.map(r => (
              <tr key={r.index} className={r.isMine ? 'crew-mine' : undefined}>
                <td>{formatCents(r.crewCents)}</td>
                {me.canLead && <td>{r.leadCents != null ? formatCents(r.leadCents) : ''}</td>}
                <td>{r.isMine ? 'You are here' : r.index === 0 ? 'Starting rate' : r.index === ladder.length - 1 ? 'Top rate' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>How cancelling works</h2>
      <div className="crew-card">
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {cancellingLines(s, new Date()).map((line, i) => <li key={i} style={{ marginBottom: '.45rem' }}>{line}</li>)}
        </ul>
      </div>

      <h2>Parties I&apos;ve worked</h2>
      {records.length === 0 ? (
        <p className="crew-muted">Once you&apos;ve worked a party, your pay and tips show here.</p>
      ) : (
        <>
          <p className="crew-muted crew-small" style={{ marginTop: 0 }}>Total so far, with tips: <strong>{formatCents(total)}</strong></p>
          {records.map((r, i) => (
            <div key={i} className="crew-card">
              <div className="crew-row" style={{ justifyContent: 'space-between' }}>
                <strong>{r.partyTitle}</strong>
                <span className="crew-muted crew-small">{partyDayLabel(r.startsAt)}</span>
              </div>
              <div className="crew-meta">
                <span>{r.role === 'lead' ? 'Party Lead' : 'Crew'}: {formatCents((r.payCents ?? 0) + (r.extraCents ?? 0))}</span>
                <span>Tips: {formatCents(r.tipCents ?? 0)}</span>
                {(r.tipTopupCents ?? 0) > 0 && <span>Top-up: {formatCents(r.tipTopupCents ?? 0)}</span>}
                <span>{r.paidAt ? `Paid ${partyDayLabel(r.paidAt)}${r.paidMethod ? ` by ${METHOD[r.paidMethod] ?? r.paidMethod}` : ''}` : 'Not paid yet'}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  )
}
