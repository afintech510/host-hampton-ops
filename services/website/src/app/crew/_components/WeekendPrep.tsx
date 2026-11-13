'use client'

import type { WeekendItem, WeekendParty, WeekendSummary } from '@/lib/crew/weekendSummary'
import { useCrewData } from './useCrewData'

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
}).format(new Date(`${date}T12:00:00Z`))

const timeLabel = (iso: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
}).format(new Date(iso))

const items = (list: WeekendItem[]) => list.map(i => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')

function PrepLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-sm leading-snug">
      <dt className="crew-muted">{label}</dt>
      <dd style={{ fontWeight: 600 }}>{value}</dd>
    </div>
  )
}

function PartyPrep({ p }: { p: WeekendParty }) {
  const hasPrep = !!(p.main || p.cupcakes || p.food.length || p.drinks.length || p.addOns.length || p.activities.length)
  return (
    <li style={{ borderTop: '1px solid var(--c-line)', padding: '.75rem 0' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span style={{ fontWeight: 700 }}>{p.title}</span>
        <span className="crew-muted crew-small">{timeLabel(p.startsAt)}</span>
      </div>
      <p className="crew-muted crew-small" style={{ margin: '.15rem 0 0' }}>
        {p.kids === null ? 'Kids unknown' : `${p.kids} kids`}
        {p.child && ` · ${p.child}`}
        {p.parent && ` · Parent: ${p.parent}`}
        {p.theme && ` · ${p.theme}`}
        {p.status === 'draft' && ' · Draft'}
      </p>
      {hasPrep ? (
        <dl className="mt-2 space-y-1">
          {p.main && <PrepLine label="Main" value={`${p.main}${p.kids === null ? '' : ` for ${p.kids}`}`} />}
          {p.cupcakes && <PrepLine label="Cupcakes" value={p.cupcakes} />}
          {p.food.length > 0 && <PrepLine label="Extra food" value={items(p.food)} />}
          {p.drinks.length > 0 && <PrepLine label="Drinks" value={items(p.drinks)} />}
          {p.addOns.length > 0 && <PrepLine label="Add-ons" value={items(p.addOns)} />}
          {p.activities.length > 0 && <PrepLine label="Activities" value={items(p.activities)} />}
        </dl>
      ) : <p className="crew-muted crew-small" style={{ margin: '.35rem 0 0' }}>Nothing extra booked.</p>}
    </li>
  )
}

/** The upcoming weekend's prep: shopping totals first, then what each party needs (read only). */
export default function WeekendPrep() {
  const { data, error, loading } = useCrewData<WeekendSummary>('/api/crew/weekend')
  const t = data?.totals
  return (
    <section className="crew-card" aria-labelledby="crew-weekend-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="crew-weekend-title">This weekend: what to prep</h3>
        {data && <span className="crew-muted crew-small">{dateLabel(data.from)} – {dateLabel(data.to)}</span>}
      </div>
      {loading && <p className="crew-muted crew-small">Loading weekend prep…</p>}
      {error && <p role="alert" className="crew-note crew-warn">Weekend prep could not be read: {error}</p>}
      {data && data.parties.length === 0 && <p className="crew-muted">No crew parties this weekend.</p>}
      {data && t && data.parties.length > 0 && (
        <>
          <div className="crew-row" style={{ marginTop: '.5rem' }}>
            <span className="crew-chip crew-info">{t.parties} {t.parties === 1 ? 'party' : 'parties'}</span>
            <span className="crew-chip crew-info">{t.kids} kids{data.parties.some(p => p.kids === null) ? ' known' : ''}</span>
            {t.pizzaKids > 0 && <span className="crew-chip crew-info">Pizza for {t.pizzaKids}</span>}
            {t.bagelKids > 0 && <span className="crew-chip crew-info">Bagels for {t.bagelKids}</span>}
          </div>
          {(t.cupcakes.length > 0 || t.food.length > 0 || t.drinks.length > 0 || t.addOns.length > 0 || t.activities.length > 0) && (
            <div className="crew-note crew-info" style={{ marginTop: '.75rem' }}>
              <strong>Gather for the weekend</strong>
              <dl className="mt-2 space-y-1.5">
                {t.cupcakes.length > 0 && <PrepLine label="Cupcakes" value={t.cupcakes.map(c => `${c.label} (${c.parties} ${c.parties === 1 ? 'party' : 'parties'})`).join(', ')} />}
                {t.food.length > 0 && <PrepLine label="Extra food" value={items(t.food)} />}
                {t.drinks.length > 0 && <PrepLine label="Drinks" value={items(t.drinks)} />}
                {t.addOns.length > 0 && <PrepLine label="Add-ons" value={items(t.addOns)} />}
                {t.activities.length > 0 && <PrepLine label="Activities" value={t.activities.map(a => `${a.name}${a.parties > 1 ? ` (${a.parties} parties)` : ''}`).join(', ')} />}
              </dl>
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: '.75rem 0 0' }}>{data.parties.map(p => <PartyPrep key={p.partyId} p={p} />)}</ul>
        </>
      )}
    </section>
  )
}
