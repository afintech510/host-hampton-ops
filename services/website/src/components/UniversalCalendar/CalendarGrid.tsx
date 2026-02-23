'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TimeSlot } from './types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface Props {
  viewDate: Date
  onChangeMonth: (offset: number) => void
  selectedDate: string | null // YYYY-MM-DD
  onSelectDate: (dateStr: string) => void
  slots: Record<string, TimeSlot[]>
  allowedDays?: number[]
  loading: boolean
  configured: boolean
}

function getDayStatus(daySlots: TimeSlot[] | undefined): 'open' | 'partial' | 'blocked' | 'none' {
  if (!daySlots || daySlots.length === 0) return 'none'
  const openCount = daySlots.filter(s => s.status === 'open').length
  if (openCount === daySlots.length) return 'open'
  if (openCount > 0) return 'partial'
  return 'blocked'
}

export default function CalendarGrid({
  viewDate,
  onChangeMonth,
  selectedDate,
  onSelectDate,
  slots,
  allowedDays,
  loading,
  configured,
}: Props) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDow = new Date(year, month, 1).getDay()
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="font-serif text-xl text-hampton-navy">
            {MONTHS[month]}{' '}
            <span className="text-hampton-mauve">{year}</span>
          </h3>
          {loading && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-hampton-pink animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-hampton-mauve">
                Syncing...
              </span>
            </div>
          )}
          {!loading && configured && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-hampton-mauve">
                Synced
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onChangeMonth(-1)}
            className="p-2 bg-white hover:bg-hampton-ivory rounded-full border border-hampton-mauve/20 transition-all active:scale-90"
          >
            <ChevronLeft size={16} className="text-hampton-navy" />
          </button>
          <button
            onClick={() => onChangeMonth(1)}
            className="p-2 bg-white hover:bg-hampton-ivory rounded-full border border-hampton-mauve/20 transition-all active:scale-90"
          >
            <ChevronRight size={16} className="text-hampton-navy" />
          </button>
        </div>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-3">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-hampton-mauve py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`e-${i}`} className="aspect-square" />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
          const date = new Date(year, month, day)
          const dow = date.getDay()
          const isPast = date < today
          const isToday = date.getTime() === today.getTime()
          const isSelected = selectedDate === dateStr
          const notAllowed = allowedDays && !allowedDays.includes(dow)

          const daySlots = slots[dateStr]
          const status = getDayStatus(daySlots)
          const disabled = isPast || notAllowed || status === 'blocked' || status === 'none'

          return (
            <button
              key={day}
              disabled={disabled}
              onClick={() => onSelectDate(dateStr)}
              className={`
                relative aspect-square rounded-xl flex flex-col items-center justify-center transition-all text-sm font-semibold border
                ${isSelected
                  ? 'bg-hampton-navy text-white border-hampton-navy shadow-md scale-105'
                  : isToday
                    ? 'bg-white border-hampton-pink/60 text-hampton-navy'
                    : disabled
                      ? 'bg-gray-50 text-gray-300 border-transparent cursor-not-allowed'
                      : 'bg-white border-hampton-mauve/15 text-hampton-navy hover:border-hampton-blue hover:scale-105 active:scale-95'
                }
              `}
            >
              {day}
              {!disabled && (
                <span
                  className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                    status === 'open'
                      ? 'bg-green-400'
                      : status === 'partial'
                        ? 'bg-amber-400'
                        : 'bg-gray-300'
                  }`}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
