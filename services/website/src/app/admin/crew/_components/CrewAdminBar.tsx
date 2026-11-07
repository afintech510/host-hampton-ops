'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import MemoryPanel from '@/components/admin/MemoryPanel'

/**
 * The top menu of the crew-management app, stuck to the top of every /admin/crew
 * page:
 *
 *     ✨   Dashboard   Leads   Bookings   Staff                  $   ☰
 *
 *   ✨          opens the AI assistant (the drawer in app/admin/layout.tsx listens
 *               for `hh:assistant-open`)
 *   Dashboard   the numbers: sales, backlog, bookings, events, leads
 *   Leads       the open leads as cards, filtered by type, month and week
 *   Bookings    the booked parties as cards, with who is staffed on each
 *   Staff       the roster, with the parties each person is working
 *   $           every payment: card, Venmo, Zelle, cash, event tickets
 *   ☰           Staff schedule, Settings (the crew rules) and Memories (what the
 *               assistant remembers)
 *
 * Every tab is a client-side link, and the data behind them is warmed by the shell
 * (adminData.ts), so a tab change does not wait for anything.
 *
 * There is deliberately no link back to the main admin dashboard.
 */

type Section = 'dashboard' | 'payments' | 'leads' | 'bookings' | 'staff' | 'schedule' | 'settings'

export function sectionOf(pathname: string | null | undefined): Section {
  const p = (pathname ?? '').replace(/\/+$/, '')
  if (p.startsWith('/admin/crew/payments')) return 'payments'
  if (p.startsWith('/admin/crew/leads')) return 'leads'
  if (p.startsWith('/admin/crew/bookings')) return 'bookings'
  if (p.startsWith('/admin/crew/rules')) return 'settings'
  if (p.startsWith('/admin/crew/members') || p.startsWith('/admin/crew/parties')) return 'staff'
  if (p === '/admin/crew') return 'schedule'
  return 'dashboard'
}

const ITEMS: Array<{ key: Section; href: string; label: string }> = [
  { key: 'dashboard', href: '/admin/crew/dashboard', label: 'Dashboard' },
  { key: 'leads', href: '/admin/crew/leads', label: 'Leads' },
  { key: 'bookings', href: '/admin/crew/bookings', label: 'Bookings' },
  { key: 'staff', href: '/admin/crew/members', label: 'Staff' },
]

export default function CrewAdminBar() {
  const section = sectionOf(usePathname())
  const [menuOpen, setMenuOpen] = useState(false)
  const [memoriesOpen, setMemoriesOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const pill = (on: boolean) =>
    `rounded-full px-2 sm:px-4 py-2 text-[13px] sm:text-sm font-semibold whitespace-nowrap ${on ? 'bg-hampton-navy text-[#F6F1EB]' : 'text-hampton-navy hover:bg-hampton-navy/10'}`

  return (
    <>
      <header className="sticky top-0 z-50 bg-white border-b border-hampton-navy/10 shadow-sm print:hidden" data-crew-admin-bar>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 px-2 sm:px-4 h-14">
          <nav aria-label="Crew management" className="flex items-center gap-0.5 sm:gap-2 min-w-0 overflow-x-auto">
            <button
              type="button"
              aria-label="Open the AI assistant"
              title="AI assistant"
              onClick={() => window.dispatchEvent(new CustomEvent('hh:assistant-open'))}
              className="rounded-full px-1.5 sm:px-3 py-2 text-lg leading-none hover:bg-hampton-navy/10"
            >
              ✨
            </button>
            {ITEMS.map(i => (
              <Link key={i.key} href={i.href} prefetch aria-current={section === i.key ? 'page' : undefined} className={pill(section === i.key)}>
                {i.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-0.5 shrink-0">
          <Link
            href="/admin/crew/payments"
            prefetch
            aria-label="Payments"
            title="Payments"
            aria-current={section === 'payments' ? 'page' : undefined}
            className={`grid place-items-center h-9 w-9 rounded-full text-lg font-bold leading-none ${section === 'payments' ? 'bg-hampton-navy text-[#F6F1EB]' : 'text-hampton-navy hover:bg-hampton-navy/10'}`}
          >
            $
          </Link>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
              className={`rounded-full p-2 hover:bg-hampton-navy/10 ${section === 'settings' || section === 'schedule' ? 'bg-hampton-navy/10' : ''}`}
            >
              <Menu size={22} className="text-hampton-navy" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-48 rounded-xl bg-white shadow-lg border border-hampton-navy/10 py-1">
                <Link
                  role="menuitem"
                  href="/admin/crew"
                  prefetch
                  onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2.5 text-sm text-hampton-navy hover:bg-[#F6F1EB]"
                >
                  Staff schedule
                </Link>
                <Link
                  role="menuitem"
                  href="/admin/crew/rules"
                  prefetch
                  onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2.5 text-sm text-hampton-navy hover:bg-[#F6F1EB]"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setMemoriesOpen(true)
                  }}
                  className="block w-full text-left px-4 py-2.5 text-sm text-hampton-navy hover:bg-[#F6F1EB]"
                >
                  Memories
                </button>
              </div>
            )}
          </div>
          </div>
        </div>
      </header>

      {memoriesOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-4 sm:pt-20 overflow-y-auto" role="dialog" aria-label="Memories">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-xl text-hampton-navy">Memories</h2>
              <button type="button" aria-label="Close" onClick={() => setMemoriesOpen(false)} className="text-hampton-navy/60 hover:text-hampton-navy">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-hampton-navy/60 mb-3">What the assistant keeps in mind in every chat.</p>
            <MemoryPanel />
          </div>
        </div>
      )}
    </>
  )
}
