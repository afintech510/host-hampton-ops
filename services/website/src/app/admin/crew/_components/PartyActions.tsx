'use client'

/**
 * The buttons on an opened Lead or Booking tile that make a link FOR YOU (the same
 * "Copy Invoice Link" / "Open planner" the Parties tab has) and open the AI assistant on
 * that party. Nothing here is sent to the client. The only write is the Parties tab's
 * own "make me a link" action.
 */

import { useState } from 'react'
import { copyText } from '@/lib/copyText'
import { BTN_GHOST, BTN_PRIMARY, useAdminApi } from './adminCrew'

export function usePartyLinks(bookingId: string) {
  const api = useAdminApi()
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [copied, setCopied] = useState(false)

  /** Mint a client link for the manager and copy or open it. */
  async function link(destination: 'invoice' | 'planner', mode: 'copy' | 'open') {
    setBusy(`${destination}-${mode}`)
    setToast('')
    // Opened BEFORE the request so a phone does not treat the new tab as a pop-up.
    const win = mode === 'open' ? window.open('', '_blank') : null
    const r = await api<{ portalUrl?: string; error?: string }>(`/api/admin/parties/${bookingId}`, {
      method: 'POST',
      body: { action: 'generate_portal_url', destination },
    })
    setBusy('')
    const url = r.data.portalUrl
    if (!r.ok || !url) {
      win?.close()
      setToast(r.data.error || 'Could not make the link.')
      return
    }
    if (mode === 'open') {
      if (win) win.location.href = url
      else window.open(url, '_blank')
      return
    }
    if (await copyText(url)) {
      // A check on the button for two seconds, the way every copy button works.
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      setToast('It signs in whoever opens it as the client.')
    } else {
      // No clipboard permission (some phones, some embedded browsers): show it, selectable.
      setToast(`Could not copy automatically. Press and hold to copy: ${url}`)
    }
  }
  return { link, busy, toast, copied }
}

export default function PartyActions({ bookingId, bookingRef, children }: { bookingId: string; bookingRef: string; children?: React.ReactNode }) {
  const { link, busy, toast, copied } = usePartyLinks(bookingId)
  const askAssistant = () => window.dispatchEvent(new CustomEvent('hh:assistant-open', { detail: { bookingRef } }))
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <button className={BTN_GHOST} disabled={!!busy} onClick={() => link('invoice', 'copy')}>
          {busy === 'invoice-copy' ? 'Making…' : copied ? '✓ Copied' : 'Copy invoice link'}
        </button>
        <button className={BTN_GHOST} disabled={!!busy} onClick={() => link('invoice', 'open')}>View invoice</button>
        <button className={BTN_GHOST} disabled={!!busy} onClick={() => link('planner', 'open')}>Open planner</button>
        {children}
        <button className={BTN_PRIMARY} onClick={askAssistant}>✨ Ask the AI to edit</button>
      </div>
      {toast && <div className="mt-2 text-center text-sm text-hampton-navy/70 break-all select-all">{toast}</div>}
    </div>
  )
}
