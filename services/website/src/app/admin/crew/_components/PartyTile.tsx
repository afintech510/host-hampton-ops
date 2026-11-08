'use client'

import { useId, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, Clock3, Users } from 'lucide-react'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'

const TYPE_SHORT: Record<string, string> = {
  in_studio_theme: 'Theme Party',
  mobile_party: 'Mobile Party',
  studio_rental: 'Studio Rental',
}

export function partyTitle(childName: string | null, contactName: string): string {
  if (!childName) return contactName
  return /s$/i.test(childName) ? `${childName}' Party` : `${childName}'s Party`
}

function DateBlock({ date }: { date: string | null }) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null
  if (!d || Number.isNaN(d.getTime())) {
    return (
      <span className="flex w-16 shrink-0 flex-col items-center justify-center gap-1.5 self-start rounded-xl border border-hampton-navy/10 bg-[#FAF8F5] py-3 text-hampton-navy/70 sm:w-20">
        <CalendarDays size={20} aria-hidden="true" />
        <span className="text-[11px] font-medium">No date yet</span>
      </span>
    )
  }
  const fmt = (options: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
  return (
    <span className="flex w-16 shrink-0 flex-col items-center self-start overflow-hidden rounded-xl border border-hampton-navy/10 bg-[#FAF8F5] text-center sm:w-20" aria-label={fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>
      <span className="block w-full bg-[#EDE4E0] py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-hampton-navy/70">{fmt({ month: 'short' })} {fmt({ year: 'numeric' })}</span>
      <span className="pt-1 text-[28px] font-semibold leading-tight tabular-nums text-hampton-navy sm:text-[32px]">{fmt({ day: 'numeric' })}</span>
      <span className="pb-2 text-[11px] font-medium text-hampton-navy/70">{fmt({ weekday: 'short' })}</span>
    </span>
  )
}

export function CardBadge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold leading-tight ${className}`}>{children}</span>
}

/** The same scan order, disclosure and spacing for a lead and a booked party. */
export default function PartyTile({
  kind, bookingRef, title, subtitle, partyType, date, time, guests, badge,
  amountLabel, amount, amountHint, context, preview, attention, open, onToggle, children,
}: {
  kind: 'lead' | 'booking'
  bookingRef: string
  title: string
  subtitle: string
  partyType: string | null
  date: string | null
  time: string | null
  guests: number | null
  badge: ReactNode
  amountLabel: string
  amount: ReactNode
  amountHint?: ReactNode
  context: ReactNode
  preview?: ReactNode
  attention?: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const panelId = useId()
  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-[0_2px_8px_rgba(27,47,69,0.03)] transition-[border-color,box-shadow] ${open ? 'border-hampton-navy/30 shadow-md' : attention ? 'border-amber-300/80' : 'border-hampton-navy/10 hover:border-hampton-navy/25 hover:shadow-md'}`}
      data-lead-card={kind === 'lead' ? '' : undefined}
      data-booking-tile={kind === 'booking' ? '' : undefined}
      data-ref={bookingRef}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? 'Hide' : 'View'} details for ${title}, ${bookingRef}`}
        className={`block w-full text-left text-hampton-navy outline-none transition-colors hover:bg-[#FCFBF9] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hampton-navy active:bg-[#F6F1EB] ${open ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      >
        <span className="block p-4 sm:p-5">
          <span className="flex items-start gap-3 sm:gap-4">
            <DateBlock date={date} />
            <span className="block min-w-0 flex-1">
              <span className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-hampton-navy/70 sm:text-[11px]">{TYPE_SHORT[partyType ?? ''] ?? PARTY_TYPE_LABELS[partyType || 'unknown'] ?? 'Party'}</span>
                {badge}
              </span>
              <span className="block break-words text-lg font-semibold leading-snug tracking-tight sm:text-xl">{title}</span>
              <span className="mt-1 block break-words text-xs leading-relaxed text-hampton-navy/70 sm:text-sm">{subtitle}</span>
            </span>
          </span>

          <span className="mt-4 grid grid-cols-[1fr_0.85fr_1.25fr] divide-x divide-hampton-navy/10 rounded-xl bg-[#F8F7F5] py-3">
            <span className="block min-w-0 px-3 sm:px-4">
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-hampton-navy/70 sm:text-xs"><Clock3 size={12} aria-hidden="true" />Time</span>
              <span className="mt-1 block text-xs font-semibold sm:text-sm">{time || 'Not set'}</span>
            </span>
            <span className="block min-w-0 px-3 sm:px-4">
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-hampton-navy/70 sm:text-xs"><Users size={12} aria-hidden="true" />Guests</span>
              <span className="mt-1 block text-xs font-semibold sm:text-sm">{guests ?? 'Not set'}</span>
            </span>
            <span className="block min-w-0 px-3 sm:px-4">
              <span className="block text-[10px] font-medium text-hampton-navy/70 sm:text-xs">{amountLabel}</span>
              <span className="mt-1 block break-words text-xs font-semibold tabular-nums sm:text-sm">{amount}</span>
              {amountHint && <span className="mt-0.5 block text-[10px] text-hampton-navy/70 sm:text-xs">{amountHint}</span>}
            </span>
          </span>
          {preview}
        </span>
        <span className={`flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5 ${attention ? 'border-amber-100 bg-amber-50/60' : 'border-hampton-navy/[0.07]'}`}>
          <span className="min-w-0 text-xs leading-relaxed sm:text-sm">{context}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-hampton-navy/70">
            {open ? 'Close' : 'Details'}
            <ChevronDown size={16} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
          </span>
        </span>
      </button>
      {open && <div id={panelId} role="region" aria-label={`${title} details`} className="space-y-5 border-t border-hampton-navy/10 bg-[#FCFBF9] p-4 sm:p-5">{children}</div>}
    </article>
  )
}

export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-hampton-navy/70">{title}</h3>
      {children}
    </section>
  )
}

export function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-hampton-navy/70">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-relaxed text-hampton-navy">{children}</dd>
    </div>
  )
}

export const CARD_ACTION = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-hampton-navy/15 bg-white px-3 py-2 text-xs font-semibold text-hampton-navy transition-colors hover:border-hampton-navy/35 hover:bg-[#F6F1EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hampton-navy focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 sm:text-sm'
