'use client'

/**
 * The shell around every /admin/crew page (from app/admin/crew/layout.tsx).
 *
 * It does three things, once, so the pages don't each do them on every visit:
 *
 *   1. Signs in. One check against the admin API; a stranger gets the password gate,
 *      the signed-in admin gets the app. (The per-page gates further down are now
 *      redundant and never show.)
 *   2. Holds the sticky top menu, so a tab change swaps only the page under it.
 *   3. Warms the data every screen reads (adminData.ts) and prefetches every screen's
 *      code, so a tab opens from memory and then quietly refreshes.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import CrewAdminBar from './CrewAdminBar'
import { LoginGate, useAdminApi } from './adminCrew'
import { clearCache, warm } from './adminData'


/** Every read a screen starts from. */
export const WARM_PATHS = [
  '/api/admin/crew-app/dashboard',
  '/api/admin/crew/weekend',
  '/api/admin/crew-app/bookings',
  '/api/admin/crew-app/payments',
  '/api/admin/leads',
  '/api/admin/crew/members',
  '/api/admin/crew',
]

/** Every screen, so its code is already here when its tab is tapped. */
export const WARM_ROUTES = [
  '/admin/crew/dashboard',
  '/admin/crew/leads',
  '/admin/crew/bookings',
  '/admin/crew/payments',
  '/admin/crew/members',
  '/admin/crew/schedule',
  '/admin/crew/rules',
]

export default function CrewAdminShell({ children }: { children: React.ReactNode }) {
  const api = useAdminApi()
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)

  // Any admin route answers 401 to a stranger; this one is cheap and read-only.
  const check = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api('/api/admin/parties/resolve?ref=PING')
    if (r.status === 401) {
      setAuthed(false)
      return 'unauthorized'
    }
    setAuthed(true)
    return 'ok'
  }, [api])

  useEffect(() => {
    check()
  }, [check])

  useEffect(() => {
    if (!authed) return
    warm(WARM_PATHS)
    for (const r of WARM_ROUTES) router.prefetch(r)
  }, [authed, router])

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) {
    return (
      <LoginGate
        title="Crew management"
        onSignedIn={async () => {
          clearCache()
          return check()
        }}
      />
    )
  }
  return (
    <div className="min-h-screen bg-[#F6F1EB]">
      <CrewAdminBar />
      {children}
    </div>
  )
}
