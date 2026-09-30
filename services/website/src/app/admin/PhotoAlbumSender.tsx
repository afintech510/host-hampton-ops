'use client'

import { useState } from 'react'
import {
  PHOTO_ALBUM_SUBJECT, OCCASION_MAX_LENGTH,
  defaultOccasion, photoAlbumText, screenFotoshareUrl, screenOccasion,
} from '@/lib/photoAlbum'

export interface PhotoAlbumBooking {
  id: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  child_name: string | null
  event_type?: string | null
  party_type?: string | null
  photo_gallery_url: string | null
}

/**
 * "📷 Photo Booth Album" — paste the Fotoshare link, check the preview, send.
 *
 * The preview is `photoAlbumText`, the same function the server sends with, so
 * what is shown here is exactly what the customer receives. Used by the Parties
 * detail panel and by each row of the Photos tab.
 */
export default function PhotoAlbumSender({
  booking, headers, onSent, compact = false,
}: {
  booking: PhotoAlbumBooking
  headers: HeadersInit
  onSent?: (albumUrl: string) => void
  /** Photos-tab rows: hide the preview until asked for. */
  compact?: boolean
}) {
  const seededUrl = screenFotoshareUrl(booking.photo_gallery_url).ok ? booking.photo_gallery_url || '' : ''
  const [url, setUrl] = useState(seededUrl)
  const [occasion, setOccasion] = useState(() => defaultOccasion(booking))
  const [viaEmail, setViaEmail] = useState(!!booking.contact_email)
  const [viaSms, setViaSms] = useState(!!booking.contact_phone)
  const [showPreview, setShowPreview] = useState(!compact)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const urlCheck = screenFotoshareUrl(url)
  const occCheck = screenOccasion(occasion)
  const preview = urlCheck.ok && occCheck.ok
    ? photoAlbumText({ contactName: booking.contact_name, occasion: occCheck.occasion, albumUrl: urlCheck.url })
    : null
  const canSend = !!preview && (viaEmail || viaSms) && !sending

  async function post(resend: boolean) {
    const res = await fetch(`/api/admin/parties/${booking.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_photo_album', confirm: true, resend,
        url, occasion, email: viaEmail, sms: viaSms,
      }),
    })
    return { res, data: await res.json().catch(() => ({})) }
  }

  async function send() {
    if (!canSend) return
    const targets = [
      viaEmail ? `email ${booking.contact_email}` : null,
      viaSms ? `text ${booking.contact_phone}` : null,
    ].filter(Boolean).join(' and ')
    if (!confirm(`Send the photo booth album to ${booking.contact_name || 'the customer'} by ${targets}?`)) return

    setSending(true)
    setResult(null)
    try {
      let { res, data } = await post(false)
      if (res.status === 409 && data.alreadySent) {
        const when = data.lastSentAt ? new Date(data.lastSentAt).toLocaleString() : 'before'
        if (!confirm(`The album was already sent ${when}.\n\n${data.lastSummary || ''}\n\nSend it again?`)) {
          setResult({ ok: false, message: 'Not sent — already sent earlier.' })
          return
        }
        ;({ res, data } = await post(true))
      }
      if (res.ok) {
        const via: string[] = data.sentVia || []
        const failed: string[] = data.failures || []
        setResult({
          ok: failed.length === 0,
          message: `Sent via ${via.join(' + ')}.${failed.length ? ` ${failed.join(' ')}` : ''}`,
        })
        onSent?.(data.photoGalleryUrl || url)
      } else {
        setResult({ ok: false, message: data.error || 'Failed to send' })
      }
    } catch (err) {
      setResult({ ok: false, message: `Failed to send: ${err}` })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="url"
        placeholder="https://fotoshare.co/e/..."
        value={url}
        onChange={e => { setUrl(e.target.value); setResult(null) }}
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
      {url.trim() && !urlCheck.ok && <p className="text-xs text-red-600">{urlCheck.reason}</p>}

      <div>
        <label className="text-xs text-gray-500">Thank you so much for choosing us to host …</label>
        <input
          type="text"
          value={occasion}
          maxLength={OCCASION_MAX_LENGTH}
          onChange={e => { setOccasion(e.target.value); setResult(null) }}
          className="w-full border rounded-lg px-3 py-1.5 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className={`flex items-center gap-1.5 ${booking.contact_email ? '' : 'opacity-40'}`}>
          <input type="checkbox" checked={viaEmail} disabled={!booking.contact_email} onChange={e => setViaEmail(e.target.checked)} className="accent-[#1a2744]" />
          Email
        </label>
        <label className={`flex items-center gap-1.5 ${booking.contact_phone ? '' : 'opacity-40'}`}>
          <input type="checkbox" checked={viaSms} disabled={!booking.contact_phone} onChange={e => setViaSms(e.target.checked)} className="accent-[#1a2744]" />
          Text
        </label>
        {preview && (
          <button type="button" onClick={() => setShowPreview(s => !s)} className="text-xs text-[#1a2744]/70 underline ml-auto">
            {showPreview ? 'Hide preview' : 'Preview'}
          </button>
        )}
      </div>

      {preview && showPreview && (
        <div className="bg-gray-50 border rounded-lg p-3 text-xs text-gray-700">
          <p className="font-medium mb-2">Subject: {PHOTO_ALBUM_SUBJECT}</p>
          <pre className="whitespace-pre-wrap break-words font-sans">{preview}</pre>
        </div>
      )}

      <button
        onClick={send}
        disabled={!canSend}
        className="w-full bg-[#1a2744] text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {sending ? 'Sending...' : '📷 Send Photo Booth Album'}
      </button>

      {result && (
        <p className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</p>
      )}
    </div>
  )
}
