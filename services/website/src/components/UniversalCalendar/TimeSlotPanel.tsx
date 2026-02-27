'use client'

import type { TimeSlot } from './types'

interface Props {
  dateStr: string
  slots: TimeSlot[]
  selectedSlot: TimeSlot | null
  onSelectSlot: (slot: TimeSlot) => void
  durationMin: number
  heading?: string
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatDuration(min: number): string {
  if (min >= 60) {
    const hrs = Math.floor(min / 60)
    const rem = min % 60
    return rem ? `${hrs}h ${rem}m` : `${hrs} hr${hrs > 1 ? 's' : ''}`
  }
  return `${min} min`
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function TimeSlotPanel({
  dateStr,
  slots,
  selectedSlot,
  onSelectSlot,
  durationMin,
  heading,
}: Props) {
  const openSlots = slots.filter(s => s.status === 'open')

  return (
    <div>
      {heading && (
        <h3 className="font-serif text-base font-bold text-hampton-navy mb-2">{heading}</h3>
      )}
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-serif text-sm text-hampton-navy">
          {formatDateLabel(dateStr)}
        </h4>
        <span className="text-[10px] font-bold uppercase tracking-widest text-hampton-mauve">
          {formatDuration(durationMin)} blocks
        </span>
      </div>

      {openSlots.length === 0 ? (
        <p className="text-sm text-hampton-mauve italic py-4 text-center">
          No available times on this date
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto scrollbar-hide">
          {openSlots.map(slot => {
            const isSelected =
              selectedSlot?.start === slot.start && selectedSlot?.end === slot.end
            return (
              <button
                key={slot.start}
                onClick={() => onSelectSlot(slot)}
                className={`
                  px-2 py-1.5 rounded-lg text-xs font-semibold transition-all border
                  ${isSelected
                    ? 'bg-hampton-navy text-white border-hampton-navy shadow-md scale-[1.02]'
                    : 'bg-white border-hampton-mauve/15 text-hampton-navy hover:border-hampton-blue hover:scale-[1.02] active:scale-95'
                  }
                `}
              >
                {formatTime(slot.start)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
