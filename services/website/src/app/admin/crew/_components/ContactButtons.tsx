'use client'

/**
 * Reach the client from their Lead or Booking tile:
 *
 *   Text in Quo      opens the conversation with their number in Quo (or the Quo inbox when
 *                    there is none yet), where you type and send the text yourself
 *   Email in Gmail   opens a new Gmail message to them from the studio mailbox
 *   Call             the phone's own dialer
 *
 * These only OPEN something. Nothing is sent from here, and the number and address are
 * looked up from the booking on the server (contact-link route), not taken from this page.
 */

import { useState } from 'react'
import { Mail, MessageSquare, Phone } from 'lucide-react'
import { useAdminApi } from './adminCrew'
import { CARD_ACTION } from './PartyTile'

export default function ContactButtons({ bookingId, phone, email }: { bookingId: string; phone: string | null; email: string | null }) {
  const api = useAdminApi()
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  async function open(kind: 'quo' | 'gmail') {
    setBusy(kind)
    setNote('')
    // Opened BEFORE the request so a phone does not treat the new tab as a pop-up.
    const win = window.open('', '_blank')
    const r = await api<{ url?: string; note?: string; error?: string }>(`/api/admin/crew-app/contact-link?booking=${bookingId}&kind=${kind}`)
    setBusy('')
    if (!r.ok || !r.data.url) {
      win?.close()
      setNote(r.data.error || 'Could not open it.')
      return
    }
    if (win) win.location.href = r.data.url
    else window.open(r.data.url, '_blank')
    if (r.data.note) setNote(r.data.note)
  }

  if (!phone && !email) return null
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {phone && (
          <button type="button" className={CARD_ACTION} disabled={!!busy} onClick={() => open('quo')}>
            <MessageSquare size={15} className="shrink-0" aria-hidden="true" />{busy === 'quo' ? 'Opening…' : 'Text in Quo'}
          </button>
        )}
        {email && (
          <button type="button" className={CARD_ACTION} disabled={!!busy} onClick={() => open('gmail')}>
            <Mail size={15} className="shrink-0" aria-hidden="true" />{busy === 'gmail' ? 'Opening…' : 'Email in Gmail'}
          </button>
        )}
        {phone && (
          <a className={CARD_ACTION} href={`tel:${phone}`}>
            <Phone size={15} className="shrink-0" aria-hidden="true" />Call
          </a>
        )}
      </div>
      {note && <div role="status" className="mt-2 text-sm text-hampton-navy/70">{note}</div>}
    </div>
  )
}
