'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BotMessageSquare, Calendar, DollarSign, LayoutDashboard, Menu, UserPlus, Users, X } from 'lucide-react'
import MemoryPanel from '@/components/admin/MemoryPanel'

/**
 * The top menu of the crew-management app, stuck to the top of every /admin/crew
 * page. Icons only, spread evenly across the width:
 *
 *   [AI chat]  [Dashboard]  [Leads +]  [Calendar]  [Staff]  [$]  [☰]
 *
 *   AI chat     opens the AI assistant (the drawer in app/admin/layout.tsx listens
 *               for `hh:assistant-open`)
 *   Dashboard   the numbers: sales, backlog, bookings, events, leads
 *   Leads       the open leads as tiles, filtered by type, month and week
 *   Calendar    the bookings as tiles, with who is staffed on each
 *   Staff       the roster, with the parties each person is working
 *   $           every payment: card, Venmo, Zelle, cash, event tickets
 *   ☰           Staff schedule, Settings (the crew rules) and Memories (what the
 *               assistant remembers)
 *
 * Each has an accessible name (aria-label) and a hover title, since there is no text.
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

const ITEMS: Array<{ key: Section; href: string; label: string; Icon: typeof Users }> = [
  { key: 'dashboard', href: '/admin/crew/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'leads', href: '/admin/crew/leads', label: 'Leads', Icon: UserPlus },
  { key: 'bookings', href: '/admin/crew/bookings', label: 'Bookings', Icon: Calendar },
  { key: 'staff', href: '/admin/crew/members', label: 'Staff', Icon: Users },
  { key: 'payments', href: '/admin/crew/payments', label: 'Payments', Icon: DollarSign },
]

const BTN = 'grid place-items-center h-10 w-10 rounded-full'
const ICON = 'text-hampton-navy'

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

  const on = (yes: boolean) => (yes ? 'bg-hampton-navy text-[#F6F1EB]' : 'hover:bg-hampton-navy/10 active:bg-hampton-navy/10')

  return (
    <>
      <header className="sticky top-0 z-50 bg-white border-b border-hampton-navy/10 shadow-sm print:hidden" data-crew-admin-bar>
        <nav aria-label="Crew management" className="max-w-xl mx-auto flex items-center justify-evenly h-14 px-1">
          <button
            type="button"
            aria-label="Open the AI assistant"
            title="AI assistant"
            onClick={() => window.dispatchEvent(new CustomEvent('hh:assistant-open'))}
            className={`${BTN} ${on(false)}`}
          >
            <BotMessageSquare size={22} className={ICON} />
          </button>
          {ITEMS.map(({ key, href, label, Icon }) => {
            const active = section === key
            return (
              <Link key={key} href={href} prefetch aria-label={label} title={label} aria-current={active ? 'page' : undefined} className={`${BTN} ${on(active)}`}>
                <Icon size={22} className={active ? 'text-[#F6F1EB]' : ICON} />
              </Link>
            )
          })}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Menu"
              title="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
              className={`${BTN} ${on(section === 'settings' || section === 'schedule')}`}
            >
              <Menu size={22} className={section === 'settings' || section === 'schedule' ? 'text-[#F6F1EB]' : ICON} />
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
        </nav>
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
