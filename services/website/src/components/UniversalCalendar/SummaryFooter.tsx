'use client'

import type { CalendarSelection } from './types'

interface Props {
  selection: CalendarSelection | null
  onBook: () => void
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatDeposit(cents: number): string {
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

export default function SummaryFooter({ selection, onBook }: Props) {
  if (!selection?.timeSlot || !selection?.bookingType) return null

  const { date, timeSlot, bookingType } = selection
  const hasDeposit = bookingType.requires_deposit && bookingType.deposit_cents > 0

  return (
    <div className="border-t border-hampton-mauve/10 pt-4 mt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-hampton-navy truncate">
            {bookingType.label}
          </p>
          <p className="text-xs text-hampton-mauve">
            {formatDate(date)} &middot; {formatTime(timeSlot.start)} – {formatTime(timeSlot.end)}
          </p>
        </div>
        <button
          onClick={onBook}
          className="flex-shrink-0 px-5 py-2.5 bg-hampton-pink text-white text-sm font-bold rounded-full shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all"
        >
          {hasDeposit
            ? `Reserve — ${formatDeposit(bookingType.deposit_cents)} Deposit`
            : 'Book Appointment'}
        </button>
      </div>
    </div>
  )
}
