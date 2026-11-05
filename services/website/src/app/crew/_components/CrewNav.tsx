'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/crew', label: 'Parties', match: (p: string) => p === '/crew' || p.startsWith('/crew/parties') },
  { href: '/crew/availability', label: 'Availability', match: (p: string) => p.startsWith('/crew/availability') },
  { href: '/crew/pay', label: 'My pay', match: (p: string) => p.startsWith('/crew/pay') },
]

/**
 * Bottom nav (spec §8): Parties · Availability · My pay. While pay figures are
 * hidden (the launch default) the third tab is "How it works" — same page,
 * cancelling and cover only.
 */
export default function CrewNav({ payLabel = 'My pay' }: { payLabel?: string }) {
  const pathname = usePathname() ?? ''
  return (
    <nav className="crew-nav" aria-label="Crew">
      {TABS.map(t => ({ ...t, label: t.href === '/crew/pay' ? payLabel : t.label })).map(t => (
        <Link key={t.href} href={t.href} aria-current={t.match(pathname) ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
