'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/crew', label: 'Parties', match: (p: string) => p === '/crew' || p.startsWith('/crew/parties') },
  { href: '/crew/availability', label: 'Availability', match: (p: string) => p.startsWith('/crew/availability') },
  { href: '/crew/pay', label: 'My pay', match: (p: string) => p.startsWith('/crew/pay') },
  { href: '/crew/profile', label: 'Profile', match: (p: string) => p.startsWith('/crew/profile') },
]

/**
 * Bottom nav (spec §8): Parties · Availability · Profile. "My pay" sits before
 * Profile only when pay figures are switched on; at launch they are not, and
 * there is no pay tab at all.
 */
export default function CrewNav({ showPay = false }: { showPay?: boolean }) {
  const pathname = usePathname() ?? ''
  return (
    <nav className="crew-nav" aria-label="Crew">
      {TABS.filter(t => showPay || t.href !== '/crew/pay').map(t => (
        <Link key={t.href} href={t.href} aria-current={t.match(pathname) ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
