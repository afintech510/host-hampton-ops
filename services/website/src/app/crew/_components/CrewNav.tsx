'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/crew', label: 'Parties', match: (p: string) => p === '/crew' || p.startsWith('/crew/parties') },
  { href: '/crew/availability', label: 'Availability', match: (p: string) => p.startsWith('/crew/availability') },
  { href: '/crew/pay', label: 'My pay', match: (p: string) => p.startsWith('/crew/pay') },
]

/** Bottom nav (spec §8): Parties · Availability · My pay. */
export default function CrewNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="crew-nav" aria-label="Crew">
      {TABS.map(t => (
        <Link key={t.href} href={t.href} aria-current={t.match(pathname) ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
