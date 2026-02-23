'use client'

import type { BookingType } from './types'

interface Props {
  types: BookingType[]
  selected: string
  onSelect: (slug: string) => void
}

const GROUP_ORDER = [
  { label: 'Parties', match: (t: BookingType) => t.tags.includes('kids-party') || t.tags.includes('childrens') || t.slug === 'room-rental' },
  { label: 'By Appointment', match: (t: BookingType) => t.slot_duration_min <= 30 },
  { label: 'Events & Rentals', match: (_: BookingType) => true },
]

export default function EventTypeSelector({ types, selected, onSelect }: Props) {
  // Group types — each type goes into the first matching group
  const assigned = new Set<string>()
  const groups = GROUP_ORDER.map(g => {
    const items = types.filter(t => {
      if (assigned.has(t.slug)) return false
      if (g.match(t)) { assigned.add(t.slug); return true }
      return false
    })
    return { ...g, items }
  }).filter(g => g.items.length > 0)

  return (
    <div className="space-y-3">
      {groups.map(group => (
        <div key={group.label}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-hampton-mauve mb-1.5 ml-1">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.items.map(t => (
              <button
                key={t.slug}
                onClick={() => onSelect(t.slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  selected === t.slug
                    ? 'bg-hampton-pink text-white shadow-sm'
                    : 'bg-white border border-hampton-mauve/30 text-hampton-navy hover:border-hampton-pink/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
