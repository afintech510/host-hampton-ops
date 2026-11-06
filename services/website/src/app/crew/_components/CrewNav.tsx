'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarClock, PartyPopper, Receipt, UserRound } from 'lucide-react'

const TABS = [
  { href: '/crew', emoji: '🥳', Icon: PartyPopper, label: 'Work', match: (p: string) => p === '/crew' || p.startsWith('/crew/parties') },
  { href: '/crew/availability', emoji: '🗓️', Icon: CalendarClock, label: 'Availability', match: (p: string) => p.startsWith('/crew/availability') },
  { href: '/crew/pay', emoji: '💵', Icon: Receipt, label: 'My pay', match: (p: string) => p.startsWith('/crew/pay') },
  { href: '/crew/profile', emoji: '🪪', Icon: UserRound, label: 'Profile', match: (p: string) => p.startsWith('/crew/profile') },
]

/**
 * Tabs (spec §8): 🥳 Work · 🗓️ Availability · 🪪 Profile. Each carries its emoji AND an outline icon;
 * the look decides which shows (and whether the bar sits at the bottom or the top). "My pay" sits before
 * Profile only when pay figures are switched on; at launch they are not, and
 * there is no pay tab at all.
 */
export default function CrewNav({ showPay = false }: { showPay?: boolean }) {
  const pathname = usePathname() ?? ''
  return (
    <nav className="crew-nav" aria-label="Crew">
      {TABS.filter(t => showPay || t.href !== '/crew/pay').map(t => (
        <Link key={t.href} href={t.href} aria-current={t.match(pathname) ? 'page' : undefined}>
          <span className="crew-nav-emoji" aria-hidden="true">{t.emoji}</span>
          <span className="crew-nav-line" aria-hidden="true"><t.Icon size={22} strokeWidth={2.2} /></span>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  )
}
