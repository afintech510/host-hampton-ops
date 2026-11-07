'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BotMessageSquare, Brain, Calendar, CalendarClock, DollarSign, LayoutDashboard, Menu, Settings, UserPlus, Users, X } from 'lucide-react'
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
 * Opening the ☰ drops a panel from the bar: every icon's name directly under it (the
 * seven are equal-width cells, so the labels line up), then the three menu items, each
 * with a line saying what it does. Closed, the bar is icons only.
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
/** One of the seven equal-width cells of the bar, and of the label row under it. */
const CELL = 'flex-1 min-w-0 flex justify-center'

/** The label row's names, in the bar's order: the assistant, the five tabs, then the hamburger. */
const LABELS = ['Assistant', ...ITEMS.map(i => i.label), 'Menu']

const MENU_ITEM = 'flex w-full items-center gap-3 px-3 py-2.5 text-left text-hampton-navy hover:bg-[#F6F1EB] active:bg-[#F6F1EB]'

export default function CrewAdminBar() {
  const section = sectionOf(usePathname())
  const [menuOpen, setMenuOpen] = useState(false)
  const [memoriesOpen, setMemoriesOpen] = useState(false)
  const menuRef = useRef<HTMLElement>(null)
  const menuActive = section === 'settings' || section === 'schedule'

  // Close the panel on an outside click or Escape. The ref is the whole header, panel included.
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
      <header ref={menuRef} className="sticky top-0 z-50 bg-white border-b border-hampton-navy/10 shadow-sm print:hidden" data-crew-admin-bar>
        <nav aria-label="Crew management" className="max-w-xl mx-auto flex items-center h-14 px-1">
          <div className={CELL}>
            <button
              type="button"
              aria-label="Open the AI assistant"
              title="AI assistant"
              onClick={() => {
                setMenuOpen(false)
                window.dispatchEvent(new CustomEvent('hh:assistant-open'))
              }}
              className={`${BTN} ${on(false)}`}
            >
              <BotMessageSquare size={22} className={ICON} />
            </button>
          </div>
          {ITEMS.map(({ key, href, label, Icon }) => {
            const active = section === key
            return (
              <div key={`cell-${key}`} className={CELL}>
                <Link key={key} href={href} prefetch aria-label={label} title={label} aria-current={active ? 'page' : undefined} onClick={() => setMenuOpen(false)} className={`${BTN} ${on(active)}`}>
                  <Icon size={22} className={active ? 'text-[#F6F1EB]' : ICON} />
                </Link>
              </div>
            )
          })}

          <div className={CELL}>
            <button
              type="button"
              aria-label="Menu"
              title="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
              className={`${BTN} ${on(menuActive || menuOpen)}`}
            >
              {menuOpen ? <X size={22} className="text-[#F6F1EB]" /> : <Menu size={22} className={menuActive ? 'text-[#F6F1EB]' : ICON} />}
            </button>
          </div>
        </nav>

        {menuOpen && (
          <div className="absolute inset-x-0 top-full bg-white border-b border-hampton-navy/10 shadow-lg" data-crew-menu-panel>
            <div className="max-w-xl mx-auto px-1">
              {/* What each icon above is. Decorative: every control already has its own name. */}
              <div aria-hidden="true" className="flex pb-2 -mt-1">
                {LABELS.map((name, i) => {
                  const here = i === 0 ? false : i === LABELS.length - 1 ? menuActive : ITEMS[i - 1].key === section
                  return (
                    <span key={name} className={`flex-1 min-w-0 text-center text-[11px] leading-tight ${here ? 'font-bold text-hampton-navy' : 'font-medium text-hampton-navy/65'}`}>
                      {name}
                    </span>
                  )
                })}
              </div>
              <div role="menu" className="border-t border-hampton-navy/10 py-1">
                <Link role="menuitem" href="/admin/crew" prefetch onClick={() => setMenuOpen(false)} className={MENU_ITEM}>
                  <CalendarClock size={20} aria-hidden="true" className="shrink-0" />
                  <span>
                    <span className="block text-sm font-semibold">Staff schedule</span>
                    <span className="block text-xs text-hampton-navy/60">Who is working which party</span>
                  </span>
                </Link>
                <Link role="menuitem" href="/admin/crew/rules" prefetch onClick={() => setMenuOpen(false)} className={MENU_ITEM}>
                  <Settings size={20} aria-hidden="true" className="shrink-0" />
                  <span>
                    <span className="block text-sm font-semibold">Settings</span>
                    <span className="block text-xs text-hampton-navy/60">The crew rules</span>
                  </span>
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setMemoriesOpen(true)
                  }}
                  className={MENU_ITEM}
                >
                  <Brain size={20} aria-hidden="true" className="shrink-0" />
                  <span>
                    <span className="block text-sm font-semibold">Memories</span>
                    <span className="block text-xs text-hampton-navy/60">What the assistant remembers</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
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
