'use client'

/**
 * The pull-button filters at the top of Bookings and Leads, all centred:
 *
 *   [Theme Party] [Mobile] [Studio Rental]      what kind of party (none lit = all)
 *   [Nov · 12] [Dec · 4] [Jan · 1]              the three months
 *   [All] [1] [2] [3] [4] [5]                   the weeks of the month, for drill-down
 *   Nov 8-14                                    what the lit week covers
 *
 * They only narrow what is on screen; nothing here writes anything. The choices are
 * remembered while the app stays open, so coming back to a tab finds it as you left it.
 */

import { useState } from 'react'
import { monthShort, weekCaption, weeksOfMonth, type WeekRange } from '@/lib/bookingWeeks'

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

const pill = (on: boolean) =>
  `min-h-[40px] rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
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
  weekCounts,
  week,
  onWeek,
}: {
  types: TypeKey[]
  onTypes: (t: TypeKey[]) => void
  months: MonthChip[]
  month: string
  onMonth: (m: string) => void
  /** Count per week number for the lit month; omitted for a month with no weeks (All / No date). */
  weekCounts: Record<number, number> | null
  week: number | null
  onWeek: (w: number | null) => void
}) {
  const weeks: WeekRange[] = /^\d{4}-\d{2}$/.test(month) ? weeksOfMonth(month) : []
  const lit = weeks.find(w => w.n === week)
  return (
    <div className="flex flex-col items-center gap-3" data-party-filters>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Kind of party">
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

      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Month">
        {months.map(m => (
          <button
            key={m.key}
            type="button"
            aria-pressed={month === m.key}
            onClick={() => {
              onMonth(m.key)
              onWeek(null)
            }}
            className={pill(month === m.key)}
          >
            {m.label} <span className={month === m.key ? 'opacity-70' : 'text-hampton-navy/50'}>· {m.count}</span>
          </button>
        ))}
      </div>

      {weeks.length > 0 && (
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Week of the month">
            <button type="button" aria-pressed={week === null} onClick={() => onWeek(null)} className={pill(week === null)}>
              All
            </button>
            {weeks.map(w => {
              const n = weekCounts?.[w.n] ?? 0
              return (
                <button
                  key={w.n}
                  type="button"
                  aria-pressed={week === w.n}
                  aria-label={`Week ${w.n}, ${weekCaption(w)}, ${n} ${n === 1 ? 'party' : 'parties'}`}
                  onClick={() => onWeek(week === w.n ? null : w.n)}
                  className={`${pill(week === w.n)} !px-0 w-10 ${n === 0 && week !== w.n ? 'opacity-50' : ''}`}
                >
                  {w.n}
                </button>
              )
            })}
          </div>
          <div className="text-xs text-hampton-navy/60 h-4">{lit ? `${weekCaption(lit)} · ${weekCounts?.[lit.n] ?? 0}` : `${monthShort(month)} · whole month`}</div>
        </div>
      )}
    </div>
  )
}
