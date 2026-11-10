'use client'

import { useAdminData } from './adminData'
import { whenLabel } from './adminCrew'
import type { WeekendItem, WeekendParty, WeekendSummary } from '@/lib/crew/weekendSummary'

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
}).format(new Date(`${date}T12:00:00Z`))

const items = (list: WeekendItem[]) => list.map(i => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')

function PrepLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-sm leading-snug">
      <dt className="text-hampton-navy/55">{label}</dt>
      <dd className="font-medium text-hampton-navy">{value}</dd>
    </div>
  )
}

function PartyPrep({ party }: { party: WeekendParty }) {
  const p = party
  const hasPrep = !!(p.main || p.cupcakes || p.food.length || p.drinks.length || p.addOns.length || p.activities.length)
  return (
    <li className="border-t border-hampton-navy/10 py-3 first:border-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <a href={`/admin/crew/parties/${p.partyId}`} className="font-semibold text-hampton-navy underline underline-offset-2">{p.title}</a>
        <span className="text-xs font-semibold text-hampton-navy/65">{whenLabel(p.startsAt, p.endsAt)}</span>
      </div>
      <p className="mt-0.5 text-xs text-hampton-navy/60">
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
      ) : <p className="mt-1 text-xs text-hampton-navy/50">Nothing extra booked.</p>}
    </li>
  )
}

/** Shopping totals first, followed by each party's needs for the upcoming weekend. */
export default function WeekendPrep() {
  const { data, error, loading } = useAdminData<WeekendSummary>('/api/admin/crew/weekend', 60_000)
  const t = data?.totals
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="weekend-prep-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="weekend-prep-title" className="text-lg font-bold text-hampton-navy">This weekend: what to prep</h2>
        {data && <span className="text-sm font-semibold text-hampton-navy/60">{dateLabel(data.from)} – {dateLabel(data.to)}</span>}
      </div>
      {loading && <p className="mt-3 text-sm text-hampton-navy/50">Loading weekend prep…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-amber-800">Weekend prep could not be read: {error}</p>}
      {data && data.parties.length === 0 && <p className="mt-3 text-sm text-hampton-navy/60">No crew parties this weekend.</p>}
      {data && t && data.parties.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-[#F6F1EB] px-3 py-2"><strong className="text-hampton-navy">{t.parties}</strong> {t.parties === 1 ? 'party' : 'parties'}</span>
            <span className="rounded-lg bg-[#F6F1EB] px-3 py-2"><strong className="text-hampton-navy">{t.kids}</strong> kids{data.parties.some(p => p.kids === null) ? ' known' : ''}</span>
            {t.pizzaKids > 0 && <span className="rounded-lg bg-[#F6F1EB] px-3 py-2">Pizza for <strong className="text-hampton-navy">{t.pizzaKids}</strong></span>}
            {t.bagelKids > 0 && <span className="rounded-lg bg-[#F6F1EB] px-3 py-2">Bagels for <strong className="text-hampton-navy">{t.bagelKids}</strong></span>}
          </div>
          {(t.cupcakes.length > 0 || t.food.length > 0 || t.drinks.length > 0 || t.addOns.length > 0 || t.activities.length > 0) && (
            <div className="mt-4 rounded-xl bg-[#F6F1EB] p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-hampton-navy/60">Gather for the weekend</h3>
              <dl className="space-y-1.5">
                {t.cupcakes.length > 0 && <PrepLine label="Cupcakes" value={t.cupcakes.map(c => `${c.label} (${c.parties} ${c.parties === 1 ? 'party' : 'parties'})`).join(', ')} />}
                {t.food.length > 0 && <PrepLine label="Extra food" value={items(t.food)} />}
                {t.drinks.length > 0 && <PrepLine label="Drinks" value={items(t.drinks)} />}
                {t.addOns.length > 0 && <PrepLine label="Add-ons" value={items(t.addOns)} />}
                {t.activities.length > 0 && <PrepLine label="Activities" value={t.activities.map(a => `${a.name}${a.parties > 1 ? ` (${a.parties} parties)` : ''}`).join(', ')} />}
              </dl>
            </div>
          )}
          <h3 className="mt-4 mb-2 text-xs font-bold uppercase tracking-wider text-hampton-navy/60">By party</h3>
          <ul>{data.parties.map(p => <PartyPrep key={p.partyId} party={p} />)}</ul>
        </>
      )}
    </section>
  )
}
