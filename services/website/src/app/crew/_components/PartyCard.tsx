import Link from 'next/link'
import ActionButton from './ActionButton'
import type { BoardParty } from '@/lib/crew/board'
import { formatCents } from '@/lib/crew/rules'
import { partyDayLabel, partyTimeLabel, type OpenSpotView } from '@/lib/crew/view'

const roleWord = (r: 'lead' | 'crew') => (r === 'lead' ? 'Party Lead' : 'Crew')

/** The open spots this member may see: crew spots always, the Lead spot only if they can lead. */
export function visibleSpots(b: BoardParty, canLead: boolean): OpenSpotView[] {
  return b.view.openSpots.filter(o => o.role === 'crew' || canLead)
}

/** One spot per role to claim: the first open one. Which crew spot you get makes no difference. */
function claimTargets(spots: OpenSpotView[]): OpenSpotView[] {
  const out: OpenSpotView[] = []
  for (const role of ['lead', 'crew'] as const) {
    const s = spots.find(x => x.role === role && x.canClaim)
    if (s) out.push(s)
  }
  return out
}

export default function PartyCard({ b, canLead, linkToDetail = true }: { b: BoardParty; canLead: boolean; linkToDetail?: boolean }) {
  const v = b.view
  const spots = visibleSpots(b, canLead)
  const crewOpen = spots.filter(s => s.role === 'crew').length
  const leadOpen = spots.some(s => s.role === 'lead')
  const title = v.theme || v.title

  return (
    <article className="crew-card">
      <div className="crew-row" style={{ justifyContent: 'space-between' }}>
        <h3>
          {linkToDetail ? <Link className="crew-link" href={`/crew/parties/${v.id}`}>{title}</Link> : title}
        </h3>
        {v.status === 'cancelled' && <span className="crew-chip crew-alert">Cancelled</span>}
        {v.mySlot && v.status !== 'cancelled' && (
          v.mySlot.confirmed
            ? <span className="crew-chip crew-ok">Confirmed</span>
            : <span className="crew-chip crew-warn">Not confirmed yet</span>
        )}
      </div>
      <div className="crew-meta">
        <span>{partyDayLabel(v.startsAt)}</span>
        <span>{partyTimeLabel(v.startsAt, v.endsAt)}</span>
        <span>{v.guestCount != null ? `${v.guestCount} kids` : 'Kids TBC'}</span>
        <span>Crew {v.staffed}/{v.needed}</span>
      </div>

      {v.mySlot && (
        <p style={{ margin: '0 0 .5rem' }}>
          You&apos;re {v.mySlot.role === 'lead' ? 'the Party Lead' : 'on the crew'}: <strong>{formatCents(v.mySlot.payCents)}</strong>
        </p>
      )}

      {!v.mySlot && b.upcoming && spots.length > 0 && (
        <p style={{ margin: '0 0 .5rem' }}>
          {crewOpen > 0 && <>{crewOpen} crew {crewOpen === 1 ? 'spot' : 'spots'} open: <strong>{formatCents(spots.find(s => s.role === 'crew')!.payCents)}</strong> for you</>}
          {crewOpen > 0 && leadOpen && <br />}
          {leadOpen && <>Party Lead spot open: <strong>{formatCents(spots.find(s => s.role === 'lead')!.payCents)}</strong> for you</>}
        </p>
      )}

      {!v.mySlot && b.claimBlock && (
        <p className="crew-note crew-info">
          {b.claimBlock === 'overlap' ? "You're working another party then." : "You've marked yourself unavailable then."}
        </p>
      )}

      <div className="crew-row">
        {b.needsConfirm && v.mySlot && (
          <ActionButton endpoint="/api/crew/confirm" body={{ slotId: v.mySlot.slotId }} label="I'll be there" />
        )}
        {!v.mySlot && b.upcoming && !b.claimBlock && claimTargets(spots).map(s => (
          <ActionButton key={s.slotId} endpoint="/api/crew/claim" body={{ slotId: s.slotId }}
            label={`Take ${s.role === 'lead' ? 'the Lead spot' : 'a crew spot'} (${formatCents(s.payCents)})`} busyLabel="Taking it…" />
        ))}
        {!v.mySlot && b.upcoming && (
          <ActionButton
            endpoint="/api/crew/standby" body={{ partyId: v.id, on: !v.iAmStandby }} variant="ghost"
            label={v.iAmStandby ? "I'm a standby ✓ (tap to stop)" : 'I can cover (standby)'}
          />
        )}
        {b.canUndo && v.mySlot && (
          <ActionButton endpoint="/api/crew/unclaim" body={{ slotId: v.mySlot.slotId }} variant="ghost" label="Undo"
            confirmText={`Give back your ${roleWord(v.mySlot.role).toLowerCase()} spot on ${title}?`} />
        )}
      </div>
    </article>
  )
}
