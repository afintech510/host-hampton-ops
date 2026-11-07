'use client'

/**
 * The pull-button filters at the top of Bookings and Leads, all centred:
 *
 *   [Theme Party] [Mobile] [Studio Rental]      what kind of party (none lit = all)
 *   [Nov · 12] [Dec · 4] [Jan · 1]              the three months
 *   [All] [Sat] [Sun] [1] [5] [7]               weekends, then the dates that have something on
 *
 * They only narrow what is on screen; nothing here writes anything. The choices are
 * remembered while the app stays open, so coming back to a tab finds it as you left it.
 */

import { useState } from 'react'
import { dayCaption, dayOfMonth, type WeekendKey } from '@/lib/bookingWeeks'

export const TYPE_PILLS = [
  { key: 'in_studio_theme', label: 'Theme Party' },
  { key: 'mobile_party', label: 'Mobile' },
  { key: 'studio_rental', label: 'Studio Rental' },
] as const
export type TypeKey = (typeof TYPE_PILLS)[number]['key']

/** Does a party of this type pass the lit type pills? (None lit = everything.) */
export function passesTypes(partyType: string | null | undefined, lit: TypeKey[]): boolean {
  if (lit.length === 0) return true
  return lit.includes((partyType ?? '') as TypeKey)
}

const memory = new Map<string, unknown>()

/** useState that remembers its value for the life of the page, per key. */
export function useRemembered<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial))
  return [
    value,
    (v: T) => {
      memory.set(key, v)
      setValue(v)
    },
  ]
}

/** The small pull-button look shared by every filter row (Bookings, Leads, Payments). */
export const pill = (on: boolean) =>
  `h-8 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors ${
    on ? 'bg-hampton-navy text-[#F6F1EB] shadow-sm' : 'bg-white text-hampton-navy border border-hampton-navy/15 active:bg-hampton-navy/10'
  }`

export interface MonthChip {
  /** `2026-11`, or a special key such as 'all', 'none', 'later'. */
  key: string
  label: string
  count: number
}

export default function PartyFilters({
  types,
  onTypes,
  months,
  month,
  onMonth,
  dayCounts,
  day,
  onDay,
  weekend,
  onWeekend,
}: {
  types: TypeKey[]
  onTypes: (t: TypeKey[]) => void
  months: MonthChip[]
  month: string
  onMonth: (m: string) => void
  /** Count per `YYYY-MM-DD` for the dates that have something on in the lit month; null for All / Later / No date. */
  dayCounts: Record<string, number> | null
  /** The lit date, or null for the whole month. */
  day: string | null
  onDay: (d: string | null) => void
  /** Lit weekend days; none lit = every day. */
  weekend: WeekendKey[]
  onWeekend: (w: WeekendKey[]) => void
}) {
  const dates = dayCounts ? Object.keys(dayCounts).sort() : []
  const showRow = month !== 'none'
  const clearAll = day === null && weekend.length === 0
  return (
    <div className="flex flex-col items-center gap-1.5" data-party-filters>
      <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Kind of party">
        {TYPE_PILLS.map(t => {
          const on = types.includes(t.key)
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => onTypes(on ? types.filter(x => x !== t.key) : [...types, t.key])}
              className={pill(on)}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Month">
        {months.map(m => (
          <button
            key={m.key}
            type="button"
            aria-pressed={month === m.key}
            onClick={() => {
              onMonth(m.key)
              onDay(null)
            }}
            className={pill(month === m.key)}
          >
            {m.label} <span className={month === m.key ? 'opacity-70' : 'text-hampton-navy/50'}>· {m.count}</span>
          </button>
        ))}
      </div>

      {showRow && (
        <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Day">
          <button
            type="button"
            aria-pressed={clearAll}
            onClick={() => {
              onDay(null)
              onWeekend([])
            }}
            className={pill(clearAll)}
          >
            All
          </button>
          {(['sat', 'sun'] as const).map(k => {
            const on = weekend.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onDay(null)
                  onWeekend(on ? weekend.filter(x => x !== k) : [...weekend, k])
                }}
                className={pill(on)}
              >
                {k === 'sat' ? 'Sat' : 'Sun'}
              </button>
            )
          })}
          {dates.map(d => {
            const n = dayCounts?.[d] ?? 0
            return (
              <button
                key={d}
                type="button"
                aria-pressed={day === d}
                aria-label={`${dayCaption(d)}, ${n} ${n === 1 ? 'party' : 'parties'}`}
                title={`${dayCaption(d)} · ${n}`}
                onClick={() => onDay(day === d ? null : d)}
                className={`${pill(day === d)} !px-0 w-8`}
              >
                {dayOfMonth(d)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
