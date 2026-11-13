'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarClock, CalendarDays, ClipboardList, PartyPopper, Receipt, UserRound } from 'lucide-react'

const TABS = [
  { href: '/crew', emoji: '🥳', Icon: PartyPopper, label: 'Parties', match: (p: string) => p === '/crew' || p.startsWith('/crew/parties') },
  { href: '/crew/bookings', emoji: '📋', Icon: ClipboardList, label: 'Bookings', match: (p: string) => p.startsWith('/crew/bookings') },
  { href: '/crew/schedule', emoji: '👥', Icon: CalendarDays, label: 'Schedule', match: (p: string) => p.startsWith('/crew/schedule') },
  { href: '/crew/availability', emoji: '🗓️', Icon: CalendarClock, label: 'Availability', match: (p: string) => p.startsWith('/crew/availability') },
  { href: '/crew/pay', emoji: '💵', Icon: Receipt, label: 'My pay', match: (p: string) => p.startsWith('/crew/pay') },
  { href: '/crew/profile', emoji: '🪪', Icon: UserRound, label: 'Profile', match: (p: string) => p.startsWith('/crew/profile') },
]

/**
 * Every tab is a prefetched client-side link (the whole page is fetched ahead, not just its shell),
 * so changing tab shows the page at once; app/crew/loading.tsx covers the rare cold one.
 *
 * Tabs (spec §8): 🥳 Parties ·🗓️ Availability · 🪪 Profile. Each carries its emoji AND an outline icon;
 * the look decides which shows (and whether the bar sits at the bottom or the top). "My pay" sits before
 * Profile only when pay figures are switched on; at launch they are not, and
 * there is no pay tab at all. "Bookings" and "Schedule" (read-only, migration 100) follow Parties only
 * for a member who has been given the view.
 */
export default function CrewNav({ showPay = false, showBookings = false }: { showPay?: boolean; showBookings?: boolean }) {
  const pathname = usePathname() ?? ''
  const bookingTabs = ['/crew/bookings', '/crew/schedule']
  return (
    <nav className="crew-nav" aria-label="Crew">
      {TABS.filter(t => (showPay || t.href !== '/crew/pay') && (showBookings || !bookingTabs.includes(t.href))).map(t => (
        <Link key={t.href} href={t.href} prefetch aria-current={t.match(pathname) ? 'page' : undefined}>
          <span className="crew-nav-emoji" aria-hidden="true">{t.emoji}</span>
          <span className="crew-nav-line" aria-hidden="true"><t.Icon size={22} strokeWidth={2.2} /></span>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  )
}
