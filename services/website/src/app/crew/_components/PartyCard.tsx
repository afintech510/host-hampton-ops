import Link from 'next/link'
import { CalendarDays, Clock, MapPin, Users } from 'lucide-react'
import AcceptAssignment from './AcceptAssignment'
import ActionButton from './ActionButton'
import CommitButton from './CommitButton'
import FindCover from './FindCover'
import ResponseButtons from './ResponseButtons'
import { TENANT } from '@/tenant'
import { STUDIO_PHONE_DISPLAY } from '@/lib/studioLocation'
import type { BoardParty } from '@/lib/crew/board'
import { formatCents } from '@/lib/crew/rules'
import { partyDateParts, partyDayLabel, partyTimeLabel, type OpenSpotView } from '@/lib/crew/view'

const roleWord = (r: 'lead' | 'crew') => (r === 'lead' ? 'Party Lead' : 'Crew')

/** ": $58.50 for you", or nothing while pay figures are hidden. */
function forYou(cents: number | null) {
  return cents == null ? null : <>: <strong>{formatCents(cents)}</strong> for you</>
}

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
  const date = partyDateParts(v.startsAt)

  return (
    <article className={`crew-card crew-party${linkToDetail ? ' crew-party-click' : ''}`}>
      <div className="crew-date" aria-hidden="true">
        <span className="crew-date-mon">{date.mon}</span>
        <span className="crew-date-day">{date.day}</span>
        <span className="crew-date-dow">{date.dow}</span>
      </div>
      <div className="crew-party-main">
      <div className="crew-row" style={{ justifyContent: 'space-between' }}>
        <h3>
          {linkToDetail ? <Link className="crew-link crew-party-link" href={`/crew/parties/${v.id}`} prefetch>{title}</Link> : title}
        </h3>
        {v.status === 'cancelled' && <span className="crew-chip crew-alert">Cancelled</span>}
        {v.mySlot && v.status !== 'cancelled' && (
          v.mySlot.confirmed
            ? <span className="crew-chip crew-ok">Confirmed</span>
            : <span className="crew-chip crew-warn">Needs your acceptance</span>
        )}
      </div>
      {v.work && <p className="crew-kind"><span aria-hidden="true">{v.work.emoji}</span> {v.work.label}</p>}
      <div className="crew-meta">
        <span className="crew-m crew-m-day"><CalendarDays className="crew-mi" size={15} aria-hidden="true" />{partyDayLabel(v.startsAt)}</span>
        <span className="crew-m"><Clock className="crew-mi" size={15} aria-hidden="true" />{partyTimeLabel(v.shiftStartsAt, v.shiftEndsAt)}</span>
        {v.city && <span className="crew-m"><MapPin className="crew-mi" size={15} aria-hidden="true" />{v.city}</span>}
        {!v.work && <span className="crew-m">{v.guestCount != null ? `${v.guestCount} kids` : 'Kids TBC'}</span>}
        <span className="crew-m"><Users className="crew-mi" size={15} aria-hidden="true" />Crew {v.staffed}/{v.needed}</span>
      </div>

      {v.mySlot && (
        <p style={{ margin: '0 0 .5rem' }}>
          You&apos;re {v.mySlot.role === 'lead' ? 'the Party Lead' : 'on the crew'}
          {v.mySlot.payCents != null && <>: <strong>{formatCents(v.mySlot.payCents)}</strong></>}
        </p>
      )}

      {!v.mySlot && b.upcoming && spots.length > 0 && (
        <p style={{ margin: '0 0 .5rem' }}>
          {crewOpen > 0 && <>{crewOpen} crew {crewOpen === 1 ? 'spot' : 'spots'} open{forYou(spots.find(s => s.role === 'crew')!.payCents)}</>}
          {crewOpen > 0 && leadOpen && <br />}
          {leadOpen && <>Party Lead spot open{forYou(spots.find(s => s.role === 'lead')!.payCents)}</>}
        </p>
      )}

      {!v.mySlot && b.claimBlock && (
        <p className="crew-note crew-info">
          {b.claimBlock === 'overlap' ? "You're working another party then." : "You've marked yourself unavailable then."}
        </p>
      )}

      <div className="crew-row">
        {b.needsConfirm && v.mySlot && (
          <AcceptAssignment slotId={v.mySlot.slotId} partyTitle={title} dayLabel={partyDayLabel(v.startsAt)}
            shiftLabel={partyTimeLabel(v.shiftStartsAt, v.shiftEndsAt)} roleWord={roleWord(v.mySlot.role)} calUrl={b.calUrl} />
        )}
        {!v.mySlot && b.upcoming && v.selection.mode === 'pick' && (
          <ResponseButtons partyId={v.id} current={v.selection.myResponse} canWork={!b.claimBlock && claimTargets(spots).length > 0}
            noun={v.work ? 'shift' : 'party'} managerName={TENANT.people.customerSignoff} />
        )}
        {!v.mySlot && b.upcoming && v.selection.mode !== 'pick' && !b.claimBlock && claimTargets(spots).map(s => (
          <CommitButton key={s.slotId} slotId={s.slotId} partyTitle={title}
            when={`${partyDayLabel(v.startsAt)}, ${partyTimeLabel(s.shiftStartsAt, s.shiftEndsAt)}`} roleWord={roleWord(s.role)}
            label={`Commit to Party${s.role === 'lead' ? ' as Party Lead' : ''}${s.payCents != null ? ` (${formatCents(s.payCents)})` : ''}`} />
        ))}
        {!v.mySlot && b.upcoming && v.selection.mode !== 'pick' && (
          <ActionButton
            endpoint="/api/crew/standby" body={{ partyId: v.id, on: !v.iAmStandby }} variant="ghost"
            label={v.iAmStandby
              ? (spots.length === 0 ? "I'm on the waitlist ✓ (tap to leave)" : "I'm a standby ✓ (tap to stop)")
              : (spots.length === 0 ? 'Join the waitlist' : 'I can cover (standby)')}
          />
        )}
        {!linkToDetail && v.mySlot && v.mySlot.status === 'assigned' && b.upcoming && (
          <FindCover slotId={v.mySlot.slotId} partyId={v.id} ownerName={TENANT.people.customerSignoff} ownerPhone={STUDIO_PHONE_DISPLAY} />
        )}
      </div>
      </div>
    </article>
  )
}
