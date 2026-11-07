'use client'

/**
 * /admin/crew/bookings - the Parties list and the admin view of a party, the same
 * screen the main dashboard's Parties tab shows, inside the crew-management menu.
 * `?party=<id>` or `?ref=<booking ref>` opens that party (the Leads cards and the
 * assistant link here).
 */

import { useCallback, useEffect, useState } from 'react'
import PartiesTab from '@/app/admin/PartiesTab'
import { CrewFrame, LoginGate, useAdminApi } from '../_components/adminCrew'

const TOKEN_KEY = 'hh_admin_token'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function CrewBookingsPage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [deepLink, setDeepLink] = useState<{ id?: string; ref?: string } | null>(null)
  const [headers, setHeaders] = useState<Record<string, string>>({ 'Content-Type': 'application/json' })

  // Any admin route answers 401 to a stranger; this one is cheap and read-only.
  const check = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api('/api/admin/parties/resolve?ref=PING')
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    const t = localStorage.getItem(TOKEN_KEY)
    setHeaders({ 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) })
    setAuthed(true)
    return 'ok'
  }, [api])

  useEffect(() => { check() }, [check])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const id = q.get('party') ?? ''
    const ref = q.get('ref') ?? ''
    if (UUID.test(id)) setDeepLink({ id })
    else if (/^[A-Za-z0-9-]{3,40}$/.test(ref)) setDeepLink({ ref })
  }, [])

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Bookings" onSignedIn={check} />

  return (
    <CrewFrame active="/admin/crew/bookings" title="Bookings">
      <PartiesTab
        headers={headers}
        deepLink={deepLink}
        onLogout={() => {
          localStorage.removeItem(TOKEN_KEY)
          window.location.reload()
        }}
      />
    </CrewFrame>
  )
}
