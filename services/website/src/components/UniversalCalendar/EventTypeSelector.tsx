'use client'

import {
  PartyPopper, Users, Home, UtensilsCrossed, Gem, Crown,
  ShoppingBag, Briefcase, Sparkles, Store, Eye, Camera,
  Sun, Handshake, BookOpen, Compass, Megaphone, CalendarHeart,
  Calendar,
  type LucideIcon,
} from 'lucide-react'
import type { BookingType } from './types'

const ICON_MAP: Record<string, LucideIcon> = {
  'kids-party': PartyPopper,
  'team-party': Users,
  'room-rental': Home,
  'private-catered': UtensilsCrossed,
  'perm-jewelry': Gem,
  'custom-trucker-hat': Crown,
  'custom-canvas-bag': ShoppingBag,
  'canvas-zipper-bag': Briefcase,
  'hair-tinsel': Sparkles,
  'retail-shopping': Store,
  'see-the-room': Eye,
  'photo-shoot': Camera,
  'private-spray-tan': Sun,
  'private-meeting': Handshake,
  'book-club': BookOpen,
  'scouts-meeting': Compass,
  'pop-up': Megaphone,
  'your-event': CalendarHeart,
}

interface Props {
  types: BookingType[]
  selected: string
  onSelect: (slug: string) => void
  variant?: 'pills' | 'tiles'
}

const GROUP_ORDER = [
  { label: 'Parties', match: (t: BookingType) => t.tags.includes('kids-party') || t.tags.includes('childrens') || t.slug === 'room-rental' },
  { label: 'By Appointment', match: (t: BookingType) => t.slot_duration_min <= 30 },
  { label: 'Events & Rentals', match: (_: BookingType) => true },
]

export default function EventTypeSelector({ types, selected, onSelect, variant = 'pills' }: Props) {
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

  if (variant === 'tiles') {
    return (
      <div className="space-y-4">
        {groups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-hampton-mauve mb-2 ml-1">
              {group.label}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {group.items.map(t => {
                const Icon = ICON_MAP[t.slug] || Calendar
                const isSelected = selected === t.slug
                return (
                  <button
                    key={t.slug}
                    onClick={() => onSelect(t.slug)}
                    className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center min-h-[72px] ${
                      isSelected
                        ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm'
                        : 'border-hampton-mauve/20 bg-white hover:border-hampton-blue'
                    }`}
                  >
                    <Icon size={20} className={isSelected ? 'text-hampton-navy' : 'text-hampton-pink'} />
                    <span className={`text-[11px] font-semibold leading-tight ${
                      isSelected ? 'text-hampton-navy' : 'text-hampton-navy/70'
                    }`}>
                      {t.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Default: pills variant
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
