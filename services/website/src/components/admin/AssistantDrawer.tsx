'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import AssistantChat, { type ChatContext } from './AssistantChat'

/**
 * The back-office chat drawer: a floating button and a slide-over panel
 * (full-width on a phone, a side panel on a desktop) around the SAME
 * `AssistantChat` that /admin/assistant shows full-screen.
 *
 * WHERE IT IS MOUNTED, and why that is the whole access rule:
 *   * `app/admin/layout.tsx` — every /admin page. It checks the session itself
 *     and renders nothing for a signed-out visitor.
 *   * `/plan/[ref]/summary`, the CUSTOMER-facing invoice — only inside the
 *     server component's `isAdminView` branch (a verified `hh_admin` session).
 *     A customer's page never imports this component into its output, so the
 *     drawer's code path is not shipped to them. `assistantOverlaySurface.test.ts`
 *     pins that no other customer route may import it.
 *
 * "This" resolves to the plan on screen: the host passes `bookingRef`, or the
 * path is `/admin/lead/<ref>`, or an admin page announces one with
 *   window.dispatchEvent(new CustomEvent('hh:assistant-context', { detail: { bookingRef } }))
 * After a confirmed action it calls `router.refresh()` (server-rendered pages,
 * like the invoice, re-read) and fires `hh:admin-data-changed` for client-state
 * pages to refetch on.
 */

const TOKEN_KEY = 'hh_admin_token'
const LEAD_PATH = /^\/admin\/lead\/([^/?#]+)/

export default function AssistantDrawer({
  bookingRef = null,
  page = 'admin',
  verified = false,
}: {
  bookingRef?: string | null
  page?: 'invoice' | 'admin'
  /** True when the SERVER already verified the admin session (the invoice page). */
  verified?: boolean
}) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(verified)
  const [announcedRef, setAnnouncedRef] = useState<string | null>(null)

  useEffect(() => {
    if (verified) return
    let cancelled = false
    fetch('/api/admin/auth/session')
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setSignedIn(!!d?.authenticated || !!localStorage.getItem(TOKEN_KEY))
      })
      .catch(() => {
        if (!cancelled) setSignedIn(!!localStorage.getItem(TOKEN_KEY))
      })
    return () => {
      cancelled = true
    }
  }, [verified, pathname])

  useEffect(() => {
    const onCtx = (e: Event) => {
      const ref = (e as CustomEvent<{ bookingRef?: string | null }>).detail?.bookingRef
      setAnnouncedRef(typeof ref === 'string' && ref ? ref : null)
    }
    window.addEventListener('hh:assistant-context', onCtx)
    return () => window.removeEventListener('hh:assistant-context', onCtx)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onActionDone = useCallback(() => {
    router.refresh()
    window.dispatchEvent(new CustomEvent('hh:admin-data-changed'))
  }, [router])

  // The full-screen view IS the assistant; a drawer on top of it would be two.
  if (pathname.startsWith('/admin/assistant')) return null
  if (!signedIn) return null

  const leadRef = LEAD_PATH.exec(pathname)?.[1]
  const ref = bookingRef || announcedRef || (leadRef ? decodeURIComponent(leadRef) : null)
  const context: ChatContext = { page: bookingRef && page === 'invoice' ? 'invoice' : 'admin', bookingRef: ref }

  return (
    <div className="no-print print:hidden">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open the manager assistant"
          className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 bg-hampton-navy text-white rounded-full shadow-lg px-4 py-3 text-sm font-bold"
        >
          <Sparkles size={16} /> Assistant
        </button>
      )}
      {open && (
        <>
          <button
            aria-label="Close the manager assistant"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] bg-black/30 sm:bg-black/20"
          />
          <aside
            role="dialog"
            aria-label="Manager assistant"
            className="fixed inset-y-0 right-0 z-[61] w-full sm:w-[440px] shadow-2xl bg-white flex flex-col"
            style={{ height: '100dvh' }}
          >
            <AssistantChat context={context} variant="drawer" onActionDone={onActionDone} onClose={() => setOpen(false)} />
          </aside>
        </>
      )}
    </div>
  )
}
